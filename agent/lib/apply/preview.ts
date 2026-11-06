import type { AzureClient } from "../azure/client.js";
import { linkyClientKeyMarker, prepareLocalImageAttachment } from "../azure/attachments.js";
import { inferFromSiblings, pickWritableFields } from "../azure/fields.js";
import { commonlyFilledButMissing, fieldUsage } from "../azure/fieldUsage.js";
import type { WorkItem } from "../azure/client.js";
import { canTransition, resolveTargetState, type DeliveryIntent } from "../azure/states.js";
import type { ApplyPreview, DayPlan, LinkyProfile, PlannedChange, AttachmentPlan } from "../types.js";
import { buildClientKey, hashPreviewSnapshot } from "./idempotency.js";

export type PreviewOptions = {
  intents?: Record<string, DeliveryIntent>;
  allowHuCreate?: boolean;
  /** IDs de actividad con intención EXPLÍCITA de cerrar dicha por el usuario. */
  userExplicitCloseIntentIds?: string[];
  /** IDs con aprobación SEPARADA de cierre (distinta del approve general de apply). */
  explicitCloseApprovedIds?: string[];
};

export async function previewDayChanges(
  profile: LinkyProfile,
  plan: DayPlan,
  client: AzureClient,
  options: PreviewOptions = {},
): Promise<ApplyPreview> {
  if (plan.missingQuestions.length) {
    const empty = {
      generatedAt: new Date().toISOString(),
      changes: [] as PlannedChange[],
      humanSummary: [
        "No se generó preview de apply: faltan datos.",
        ...plan.missingQuestions.map((q) => `• ${q}`),
      ],
      requiresExplicitApproval: true as const,
      snapshotHash: "",
    };
    empty.snapshotHash = hashPreviewSnapshot(empty);
    return empty;
  }

  const changes: PlannedChange[] = [];
  const summary: string[] = [
    `Preview para ${plan.date} (proyecto=${profile.azure.project})`,
    `Contexto: ${profile.workContext.occupation} — ${profile.workContext.projectContext.slice(0, 120)}`,
    "Estados por defecto: planeación / en curso / entregado. Cierre solo con intención+aprobación separadas.",
  ];

  for (const act of plan.activities) {
    const tags = [
      ...profile.azure.defaultTags,
      profile.responsibility.responsibleTag,
    ]
      .filter(Boolean)
      .join("; ");
    const hoursActual = act.minutesSpent != null ? act.minutesSpent / 60 : undefined;
    const hoursEstimate = act.minutesEstimate != null ? act.minutesEstimate / 60 : undefined;
    const mention = profile.responsibility.responsibleMention
      ? `\nResponsable: ${profile.responsibility.responsibleMention}`
      : "";
    const evidenceBlock = [
      ...act.evidenceLinks.map((l) => `Link: ${l}`),
      ...act.meetingOrCallLinks.map((l) => `Reunión/llamada: ${l}`),
      ...act.evidenceImages.map((i) => `Foto: ${i}`),
    ].join("\n");

    const typeName = String(act.workItemType);
    const meta = profile.processCache?.[typeName] ?? (await client.getProcessMeta(typeName));

    const attachmentPlans: AttachmentPlan[] = [];
    for (const img of act.evidenceImages) {
      if (/^https?:\/\//i.test(img)) {
        summary.push(`Imagen URL no se sube automáticamente: ${img}`);
        continue;
      }
      try {
        const prepared = await prepareLocalImageAttachment(img, profile.evidence);
        attachmentPlans.push({
          localPath: prepared.localPath,
          fileName: prepared.fileName,
          contentType: prepared.contentType,
          byteLength: prepared.byteLength,
        });
      } catch (e) {
        summary.push(`Adjunto omitido (${img}): ${(e as Error).message}`);
      }
    }

    const baseDesired: Record<string, unknown> = {};
    if (tags) baseDesired["System.Tags"] = tags;
    if (hoursActual != null) baseDesired["Microsoft.VSTS.Scheduling.CompletedWork"] = Number(hoursActual.toFixed(2));
    if (hoursEstimate != null) baseDesired["Microsoft.VSTS.Scheduling.OriginalEstimate"] = Number(hoursEstimate.toFixed(2));
    if (profile.responsibility.assignedDisplayName || profile.azure.identityDisplayName) {
      baseDesired["System.AssignedTo"] =
        profile.responsibility.assignedDisplayName ?? profile.azure.identityDisplayName;
    }

    if (act.workItemId) {
      const clientKey = buildClientKey(["update", plan.date, act.id, act.workItemId]);
      const descriptionHtml = `<div><p>${escapeHtml(act.shortDescription)}</p><pre>${escapeHtml(evidenceBlock)}${escapeHtml(mention)}</pre>${linkyClientKeyMarker(clientKey)}</div>`;
      const explicitDescription = act.fields?.["System.Description"];
      const desired = {
        ...baseDesired,
        ...(act.fields ?? {}),
        "System.Description":
          typeof explicitDescription === "string" ? `${explicitDescription}${linkyClientKeyMarker(clientKey)}` : descriptionHtml,
        "System.History": typeof act.fields?.["System.History"] === "string" ? act.fields["System.History"] : escapeHtml(act.shortDescription),
      };
      const picked = pickWritableFields(meta, desired);
      for (const s of picked.skipped) summary.push(`Omitido en #${act.workItemId}: ${s}`);
      changes.push({
        op: "update",
        workItemId: act.workItemId,
        clientKey,
        fields: picked.applied,
        comment: act.shortDescription,
        attachments: attachmentPlans.length ? attachmentPlans : undefined,
        expectedRev: act.expectedRev,
      });
      summary.push(`Actualizar #${act.workItemId} (${typeName}): ${act.title}`);

      const intent = options.intents?.[act.id];
      if (intent) {
        if (intent === "cerrado") {
          const userExplicit = (options.userExplicitCloseIntentIds ?? []).includes(act.id);
          const closeApproved = (options.explicitCloseApprovedIds ?? []).includes(act.id);
          if (!userExplicit || !closeApproved) {
            summary.push(
              `NO se cierra #${act.workItemId}: falta intención explícita del usuario y/o aprobación SEPARADA de cierre.`,
            );
          } else {
            const resolved = resolveTargetState(meta, "cerrado");
            if (!resolved.state) {
              summary.push(`Cierre #${act.workItemId}: ${resolved.reason}`);
            } else {
              changes.push({
                op: "transition",
                workItemId: act.workItemId,
                clientKey: buildClientKey(["transition", plan.date, act.id, act.workItemId, resolved.state]),
                toState: resolved.state,
                comment: undefined,
                intent: "cerrado",
                workItemTypeHint: typeName,
                userExplicitCloseIntent: true,
                explicitCloseApproved: true,
                expectedRev: act.expectedRev,
              });
              summary.push(`Cerrar #${act.workItemId} → ${resolved.state} (intención+aprobación separada)`);
            }
          }
        } else {
          // planeado | en_curso | entregado
          if (intent === "entregado" && profile.taskDelivery === "scrum_or_third_party" && typeName === "Task") {
            summary.push(`No se transiciona #${act.workItemId} a entregado: política taskDelivery`);
          } else {
            const resolved = resolveTargetState(meta, intent);
            if (resolved.isCloseLike) {
              summary.push(`Bloqueado: el estado resuelto para ${intent} parece cierre (${resolved.state}).`);
            } else if (resolved.needsConfirmation || !resolved.state) {
              summary.push(`Estado para #${act.workItemId}: confirmación requerida (${resolved.reason})`);
            } else {
              changes.push({
                op: "transition",
                workItemId: act.workItemId,
                clientKey: buildClientKey(["transition", plan.date, act.id, act.workItemId, resolved.state]),
                toState: resolved.state,
                comment: undefined,
                intent,
                workItemTypeHint: typeName,
                expectedRev: act.expectedRev,
              });
              summary.push(`Transicionar #${act.workItemId} → ${resolved.state} (${resolved.reason})`);
              if (!canTransition(meta, undefined, resolved.state) && meta.transitions.length) {
                summary.push(`Aviso: transición a ${resolved.state} podría no estar permitida.`);
              }
            }
          }
        }
      }
    } else {
      if (typeName === "User Story" || /user story|historia/i.test(typeName)) {
        if (profile.huCreation === "scrum_or_third_party_only" || !options.allowHuCreate) {
          summary.push(`No se crea HU "${act.title}": política/aprobación. Indica workItemId existente.`);
          continue;
        }
      }
      if ((typeName === "Task" || /task|tarea/i.test(typeName)) && act.parentHuId == null) {
        summary.push(`No se crea Task "${act.title}" sin parentHuId verificado.`);
        continue;
      }

      // Verificar padre existe (lectura) si hay client
      let parent: WorkItem | undefined;
      if (act.parentHuId != null) {
        try {
          parent = await client.getWorkItem(act.parentHuId);
          const parentProject = String(parent.fields["System.TeamProject"] ?? profile.azure.project);
          if (parentProject && parentProject !== profile.azure.project) {
            summary.push(`Padre HU ${act.parentHuId} no está en el proyecto ${profile.azure.project}.`);
            continue;
          }
        } catch (e) {
          summary.push(`No se pudo leer HU padre ${act.parentHuId}: ${(e as Error).message}`);
          continue;
        }
      }

      const clientKey = buildClientKey(["create", plan.date, act.id, act.title]);
      const descriptionHtml = `<div><p>${escapeHtml(act.shortDescription)}</p><pre>${escapeHtml(evidenceBlock)}${escapeHtml(mention)}</pre>${linkyClientKeyMarker(clientKey)}</div>`;
      const title =
        profile.workContext.titleConvention && act.kind === "planned"
          ? act.title
          : act.title;
      // Iteración/Área de la HU padre; defaults del perfil; valores explícitos de la actividad.
      const inherited: Record<string, unknown> = {};
      for (const ref of ["System.IterationPath", "System.AreaPath"]) {
        if (parent?.fields[ref] !== undefined) inherited[ref] = parent.fields[ref];
      }
      const desired: Record<string, unknown> = {
        ...inherited,
        ...(profile.azure.taskFieldDefaults ?? {}),
        ...baseDesired,
        ...(act.fields ?? {}),
        "System.Title": title,
        // Descripción con el formato propio de la persona (HTML) si la actividad la trae; el marcador siempre al final.
        "System.Description":
          typeof act.fields?.["System.Description"] === "string"
            ? `${act.fields["System.Description"]}${linkyClientKeyMarker(clientKey)}`
            : descriptionHtml,
      };
      let picked = pickWritableFields(meta, desired);
      const estimateRef = "Microsoft.VSTS.Scheduling.OriginalEstimate";
      if (picked.missingRequired.includes(estimateRef) && act.kind === "done" && hoursActual != null) {
        desired[estimateRef] = Number(hoursActual.toFixed(2));
        summary.push(`"${act.title}": OriginalEstimate obligatorio y sin estimación previa → se usa la hora real (${desired[estimateRef]} h).`);
        picked = pickWritableFields(meta, desired);
      }
      if (picked.missingRequired.length && parent) {
        const siblings = (parent.relations ?? [])
          .filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward")
          .map((r) => Number(r.url.split("/").pop()))
          .filter(Number.isInteger);
        const inferred = await inferFromSiblings(client, siblings, picked.missingRequired);
        if (Object.keys(inferred).length) {
          Object.assign(desired, inferred);
          summary.push(
            `"${act.title}": campos tomados de Tasks hermanas de la HU ${act.parentHuId}: ${Object.entries(inferred)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")}`,
          );
          picked = pickWritableFields(meta, desired);
        }
      }
      // Campos que el equipo suele llenar en las hermanas del mismo tipo y que aquí quedarían vacíos.
      if (parent) {
        const refs: WorkItem[] = [];
        const siblingIds = (parent.relations ?? [])
          .filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward")
          .map((r) => Number(r.url.split("/").pop()))
          .filter(Number.isInteger)
          .sort((a, b) => b - a)
          .slice(0, 8);
        for (const id of siblingIds) {
          try {
            const wi = await client.getWorkItem(id);
            if (wi.fields["System.WorkItemType"] === undefined || wi.fields["System.WorkItemType"] === typeName) refs.push(wi);
          } catch {
            /* hermana ilegible: se ignora */
          }
        }
        const missingCommon = commonlyFilledButMissing(fieldUsage(meta, refs), picked.applied);
        if (missingCommon.length) {
          summary.push(
            `"${act.title}": sus hermanas (${typeName}) suelen llenar y aquí quedan vacíos: ${missingCommon
              .map((u) => `${u.name} (${u.referenceName}, ${u.filled}/${u.of})`)
              .join(", ")}. Revisa con \`azure fields\` y pregunta a la persona lo que no se pueda saber.`,
          );
        }
      }
      for (const s of picked.skipped) summary.push(`Omitido al crear "${act.title}": ${s}`);
      if (picked.missingRequired.length) {
        summary.push(`Faltan campos requeridos para crear "${act.title}": ${picked.missingRequired.join(", ")}`);
        continue;
      }
      const relations = act.parentHuId
        ? [
            {
              rel: "System.LinkTypes.Hierarchy-Reverse",
              url: `${profile.azure.organizationUrl}/${encodeURIComponent(profile.azure.project)}/_apis/wit/workItems/${act.parentHuId}`,
            },
          ]
        : undefined;
      changes.push({
        op: "create",
        clientKey,
        workItemType: typeName,
        fields: picked.applied,
        relations,
        attachments: attachmentPlans.length ? attachmentPlans : undefined,
        parentHuId: act.parentHuId,
      });
      summary.push(`Crear ${typeName}: ${act.title}${act.parentHuId ? ` (bajo HU ${act.parentHuId})` : ""}`);
    }
  }

  const preview: ApplyPreview = {
    generatedAt: new Date().toISOString(),
    changes,
    humanSummary: summary,
    requiresExplicitApproval: true,
    snapshotHash: "",
  };
  preview.snapshotHash = hashPreviewSnapshot(preview);
  return preview;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
