# Referencia Azure (documental, no validación en vivo)

Este documento describe campos candidatos. **Linky detecta metadata por proyecto** en runtime; no hardcodea que existan.

## Campos candidatos a validar

| Reference name | Notas |
| --- | --- |
| System.Title | Requerido típico |
| System.Description | HTML corto + evidencias + marcador `<!--linky:clientKey=...-->` |
| System.Tags | Tag(s) de responsable/equipo según tu org |
| System.AssignedTo | Identidad del usuario |
| System.IterationPath / AreaPath | Según sprint/área actual |
| System.State | Separar Entregado vs Closed cuando el proceso lo permita |
| System.History | Comentario de progreso |
| Microsoft.VSTS.Common.Activity / Priority | Si el proceso los tiene |
| Microsoft.VSTS.Scheduling.OriginalEstimate / CompletedWork | Solo si existen; minutos reales del usuario |
| Custom.* | Campos custom: validar siempre con metadata del proceso |

## Adjuntos

Linky sube imágenes locales vía Attachments API (`POST .../wit/attachments`) y enlaza `AttachedFile` en create/update. Límites: tipo MIME y tamaño del perfil de evidencias.

## Ejemplos

Usa solo `examples/synthetic/*` (ficticios). No copies IDs, URLs internas, nombres de terceros ni evidencias reales al repo.


## Tags vs identidad

- `System.Tags`: etiquetas de responsabilidad/equipo (p. ej. tag de cuadrilla).
- `System.AssignedTo` / menciones: identidad de persona — **separado** de Tags.

## Fotos

- Inline en Description (referencia textual/HTML) **y/o**
- Attachments API + relación `AttachedFile` (binario validado).
