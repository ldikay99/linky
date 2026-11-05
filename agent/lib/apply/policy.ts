import type { LinkyProfile, PlannedChange } from "../types.js";
import { isClosedLikeState } from "../azure/states.js";

/**
 * Revalida en apply. Cierre nunca pasa con solo approved general de apply.
 */
export function enforcePoliciesOnChange(
  profile: LinkyProfile,
  change: PlannedChange,
): { ok: true } | { ok: false; reason: string } {
  if (change.op === "create") {
    const typeName = String(change.workItemType);
    if (
      (typeName === "User Story" || /user story|historia/i.test(typeName)) &&
      profile.huCreation === "scrum_or_third_party_only"
    ) {
      return { ok: false, reason: "Política: HU solo las crea scrum/tercero; create rechazado en apply." };
    }
    if (typeName === "Task" || /task|tarea/i.test(typeName)) {
      if (change.parentHuId == null && !change.relations?.some((r) => /Hierarchy/i.test(r.rel))) {
        return { ok: false, reason: "Task requiere padre HU (parentHuId/relación) en el mismo proyecto." };
      }
    }
    return { ok: true };
  }

  if (change.op === "transition") {
    const intent = change.intent;
    const typeHint = change.workItemTypeHint ?? "Task";

    if (intent === "cerrado" || looksLikeCloseStateName(change.toState)) {
      if (profile.closeRequiresExplicitUserIntent !== true) {
        return { ok: false, reason: "Cierre bloqueado por perfil." };
      }
      if (change.userExplicitCloseIntent !== true) {
        return {
          ok: false,
          reason:
            "Cierre bloqueado: se requiere intención EXPLÍCITA del usuario para cerrar (no basta setup ni approve general).",
        };
      }
      if (change.explicitCloseApproved !== true) {
        return {
          ok: false,
          reason: "Cierre bloqueado: se requiere aprobación SEPARADA de cierre (explicitCloseApproved).",
        };
      }
      if (typeHint === "Task" && profile.taskClose === "scrum_or_third_party") {
        return { ok: false, reason: "Política taskClose=scrum_or_third_party." };
      }
      if (typeHint !== "Task" && profile.huClose === "scrum_or_third_party") {
        return { ok: false, reason: "Política huClose=scrum_or_third_party." };
      }
      return { ok: true };
    }

    if (intent === "entregado" && typeHint === "Task" && profile.taskDelivery === "scrum_or_third_party") {
      return { ok: false, reason: "Política taskDelivery=scrum_or_third_party: no marcar entregado en apply." };
    }
  }

  return { ok: true };
}

function looksLikeCloseStateName(name: string): boolean {
  return isClosedLikeState({ name, category: undefined }) || /closed|cerrad|completed/i.test(name);
}
