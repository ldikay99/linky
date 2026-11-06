---
name: linky-azure-boards
description: Guía agnóstica de IA para onboarding y registro diario en Azure Boards con CLI Linky (cualquier asistente).
---

# Linky — Azure Boards (agnóstico de proveedor)

**Autor:** Jonathan Contreras

Sirve con cualquier asistente de IA que pueda ejecutar comandos. Núcleo: `npm run linky`.

## Bienvenida (al iniciar el onboarding)

Cuando entiendas el proyecto y empieces el onboarding con la persona, ejecuta `npm run linky -- welcome`
y muestra su salida **tal cual, dentro de un bloque de código** (logo Linky y créditos a Jonathan Contreras).
Linky no usa API keys: funciona con el asistente de IA que la persona prefiera.

## Conexión (una vez por organización)

Una persona puede trabajar en **varias organizaciones** (la de su empresa y otras de clientes/consorcios).
Preguntar cuál es la **principal**: es el default para todo; usar otra solo si el usuario la indica.

```bash
npm run linky -- azure connect --org https://dev.azure.com/<org-principal> --primary   # PAT, entrada oculta (preferido)
npm run linky -- azure connect --org https://dev.azure.com/<otra-org>                  # PAT propio de esa org
npm run linky -- azure login --org https://dev.azure.com/<org>                         # alternativa sin PAT (navegador, una vez)
npm run linky -- azure orgs                                                            # estado y principal
npm run linky -- azure use --org https://dev.azure.com/<org>                           # cambiar principal
```

- PAT: recomendar crearlo con **Full access** y **90 días** de vigencia (Azure DevOps → User settings → Personal access tokens → New Token → organización, Expiration *Custom defined* 90 días, Scopes *Full access*). Confirmar una vez la amplitud (ack). Mínimo aceptable: Work Items Read & Write. Un PAT vale para la organización elegida al crearlo: uno por organización.
- Anotar la fecha de vencimiento (hoy + 90 días): Linky avisa ≤7 días antes. Azure no deja leerla desde el token.
- Preferir que el comando pida el PAT oculto. Si el usuario lo pega en el chat, guardarlo con `azure connect` (vía `LINKY_AZURE_PAT_INPUT`, nunca en archivos) y avisar una vez que quedó en el historial; rotarlo es decisión del usuario.
- Con la sesión conectada todo va por REST; el navegador solo se usa para el login.

## Leer lo que hizo la persona

```bash
npm run linky -- azure activity --date YYYY-MM-DD           # organización principal
npm run linky -- azure activity --date YYYY-MM-DD --all     # todas las conectadas
```

Devuelve los work items que **la persona** cambió ese día (zona horaria del equipo): título, proyecto, estado,
cambios de estado, horas completadas (`completedWorkDelta`), comentarios y URL. Es la fuente para la descripción
de Ripor (skill `linky-ripor`) y para no inventar trabajo.

## Setup OBLIGATORIO (una vez)

Preguntar y guardar (sin defaults inventados de proyecto):

1. **Proyecto Azure** (nombre exacto) — crítico
2. Org URL estricta + credencial (`azure connect` / `azure login`), organización principal confirmada
3. **Ocupación/rol** de la persona y **contexto del proyecto** (para redactar/refinar HU y Tasks breves y contextualizadas)
4. **Asignado** (`System.AssignedTo`) y **responsable** separados: tag (`System.Tags`) y/o mención en Description — no mezclar
5. Quién **crea** y quién **refina** HU (`user_or_ai_with_approval` | `scrum_or_third_party_only`). Si scrum/tercero: al trabajar pedir **ID HU existente**; nunca crear/clonar/mover contra política
6. Horario: texto ambiguo “lun a vie 8:30–18 y viernes 8–17” → interpretar **lun–jue 08:30–18:00 / viernes 08:00–17:00** y **confirmar**. Preguntar **almuerzo** (minutos/rango); no inventar
7. Convención de títulos (opcional configurable)
8. PAT: vencimiento user-reported (90 días recomendado) + tz dispositivo; Full access recomendado con ack (mínimo Work Items R/W)

## Crear Tasks (campos del proceso)

Al crear, Linky hereda **Iteración y Área de la HU padre**, respeta los defaults del proceso y, para campos
obligatorios propios del equipo (p. ej. `Microsoft.VSTS.Common.Activity`, `Custom.SubActividad`), usa en orden:
valor explícito de la actividad (`fields`) → `azure.taskFieldDefaults` del perfil → valor más usado en las **Tasks
hermanas** de la misma HU. Siempre valida contra los valores permitidos. Si el proceso exige estimación y la tarea
ya está hecha, usa la hora real y lo indica en el preview.

## Eliminar

Solo si el usuario lo pide explícitamente: `npm run linky -- azure delete --id <n>` (muestra qué es) y, tras su
confirmación, `--approve`. Va a la papelera de reciclaje de Azure (recuperable).

## Estados

Por defecto solo: **planeación / en curso / entregado**.

**Nunca** pasar a Closed/Completed/4.Cerrado automáticamente. Cerrar exige:

- intención **explícita del usuario** en esa acción, y
- **aprobación separada** de cierre (no basta el approve general de apply ni el permiso de setup)

## Tasks

Siempre con **HU padre** del mismo proyecto (verificar con lectura). Estimación (`OriginalEstimate`) y real (`CompletedWork`) separados; margen “un poco más” solo en planeación futura con aprobación (p.ej. +10%), sin inflar retrospectiva.

## Jornada

Validar cobertura del rango laboral sin huecos/superposición; reportar huecos reales y pedir actividad/duración — **no completar ficticio**.

## Schema

Detectar campos por proceso en runtime. No afirmar ejemplos de usuario “verificados” si la API no se leyó.

## Recordatorios PAT

CLI con reloj/tz local; scheduler OS solo opt-in documental.
