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
- Vencimiento: no se le pregunta a la persona. Linky lo lee del correo que Azure envía al crear el token
  (`azure expires --from-mail`) o se pasa con `--expires` si la persona lo sabe. Avisa ≤7 días antes.
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

Cada persona tiene SU configuración. Nunca copiar valores de otra persona, de ejemplos ni de este repo.
Con la credencial conectada, **proponer** respuestas leyendo los datos reales de la persona y **confirmarlas** con ella:
proyecto y HU donde tiene Tasks asignadas, `Activity`/campos de sus Tasks, quién crea sus HU (`System.CreatedBy`),
su nombre en Azure (`connectionData`). Lo que no se pueda leer (rol, tag/mención del responsable, almuerzo,
vencimiento del PAT) se pregunta; si no aplica, se deja vacío — no se inventa.

Preguntar y guardar (sin defaults inventados de proyecto):

1. **Proyecto Azure** (nombre exacto) — crítico
2. Org URL estricta + credencial (`azure connect` / `azure login`), organización principal confirmada
3. **Ocupación/rol** de la persona y **contexto del proyecto** (para redactar/refinar HU y Tasks breves y contextualizadas)
4. **Asignado** (`System.AssignedTo`) y **responsable** separados: tag (`System.Tags`) y/o mención en Description — no mezclar
5. Quién **crea** y quién **refina** HU (`user_or_ai_with_approval` | `scrum_or_third_party_only`). Si scrum/tercero: al trabajar pedir **ID HU existente**; nunca crear/clonar/mover contra política
6. Horario: texto ambiguo “lun a vie 8:30–18 y viernes 8–17” → interpretar **lun–jue 08:30–18:00 / viernes 08:00–17:00** y **confirmar**. Preguntar **almuerzo** (minutos/rango); no inventar
7. Convención de títulos (opcional configurable)
8. PAT: vencimiento user-reported (90 días recomendado) + tz dispositivo; Full access recomendado con ack (mínimo Work Items R/W)

## Dónde colgar las Tasks

```bash
npm run linky -- azure hus      # HU abiertas de sus sprints, con cuántas Tasks suyas tiene cada una y quién la creó
```

Si la persona NO crea HU (política `scrum_or_third_party_only`), toda Task va bajo una de estas HU; nunca crear una
HU ni colgar una Task sin padre. Elegir la HU por el tema del trabajo (el repo, el componente, Tasks previas de la
persona en esa HU) y **confirmarla con la persona**. Copiar el estilo de título de sus Tasks anteriores en esa HU
(p. ej. "Verbo + objeto - Componente"), en pasado o infinitivo, sin fechas.

## Pedir una HU nueva (cuando no existe)

Si la persona no crea HU, se le pide al responsable (scrum/líder) por chat, con borrador y aprobación:

1. **Validar el código de proyecto (CECO)** antes de proponer: `npm run linky -- azure ceco --topic "<tema>"` muestra el
   código usado en HU anteriores del tema. El código depende del proyecto y de la cuenta de la persona (p. ej. un
   proyecto de una cuenta de consorcio vs. los de la empresa); confirmarlo con ella, nunca asumirlo.
2. **Título que diga QUÉ se desarrolla** (la solución concreta), en el formato que usa ese responsable (revisar sus HU
   y su chat). Nada genérico ni que suene a trabajo manual.
3. Mensaje corto y directo, en el tono de la persona: sprint, código, título propuesto y evidencia (PRs aprobados,
   repos). Sin excusas inventadas. Validar fechas del sprint en Azure antes de mencionarlas.
4. Mostrar el mensaje y enviarlo solo con su aprobación.

## Cómo redactar HU y Tasks (cualquier área)

Linky lo usan áreas de todo tipo (desarrollo, datos, QA, soporte, comercial, talento humano, administrativas…). No
asumas que la persona programa. **Primero copia el estilo real** de su equipo: lee sus HU y Tasks anteriores
(`azure hus`, la HU padre y sus Tasks hermanas) y usa ese formato. Las plantillas de abajo son solo el respaldo
cuando no hay referencia; los `<valores>` se llenan con datos reales de la persona, nunca inventados.

**Cada campo cuenta.** Cada equipo y proceso llena campos distintos (fechas de inicio/entrega, ticket asociado,
etiqueta del responsable, criterios de aceptación, escenario, reglas de negocio…). Antes de crear o refinar:

```bash
npm run linky -- azure fields --type Task --parent <HU>            # hermanas de la misma HU como referencia
npm run linky -- azure fields --type "User Story" --like <id,id>   # HU parecidas ya refinadas
```

Muestra cada campo que el equipo llena (obligatorio o no), sus valores permitidos, cuántas referencias lo traen y un
ejemplo de formato. Propón un valor para **cada uno** desde el trabajo real; lo que no se pueda saber, pregúntalo.
Los ejemplos enseñan el formato, no se copian. El preview avisa si queda vacío un campo que las hermanas suelen
llenar. Los campos se pasan en `fields` de la actividad (la descripción en HTML va en `System.Description`, un
comentario con mención en `System.History`); para refinar una HU existente, `workItemId` + `fields`.

**Proponer antes de crear (no asumir el estilo):**

1. `npm run linky -- azure style`: si ya hay estilo aprobado, úsalo.
2. Si no hay: antes de la primera HU o Task, **propón** a la persona el formato (título y descripción) con un ejemplo
   real de su trabajo, sacado de sus HU/Tasks anteriores o, si no hay, de las plantillas de abajo. Pregunta si así
   está bien o qué cambiaría.
3. Con su aprobación, guárdalo:
   `azure style --kind task --title "<formato>" --description "<formato>" --example "<ejemplo que aprobó>"`
   (igual con `--kind hu`). Desde ahí se reutiliza sin volver a preguntar; si la persona corrige un texto después,
   actualiza el estilo.
4. Cada HU/Task concreta igual pasa por preview y aprobación.

### Crear una HU (solo si su política lo permite; si no, se pide al responsable)

```text
Título:       <CÓDIGO>_<QUÉ SE LOGRA, concreto>                     # formato del equipo; código validado con `azure ceco`
Descripción:  Como <rol que se beneficia>, necesito <qué> para <para qué / valor>.
              Contexto: <situación actual o problema, 1–2 líneas>.
Criterios de aceptación:
              - <resultado verificable 1>
              - <resultado verificable 2>
Evidencia esperada: <entregable: informe, documento, tablero, PR, acta…>
```

Ejemplos de título por área (ilustrativos, no copiar): `<código>_INFORME MENSUAL DE ROTACIÓN DE PERSONAL POR SEDE`,
`<código>_PLAN DE PRUEBAS DE REGRESIÓN DEL MÓDULO DE FACTURACIÓN`, `<código>_TABLERO DE SEGUIMIENTO DE PQRS POR CANAL`.

### Refinar una HU existente

Solo si la persona puede refinar (`huRefine`); si no, se le sugiere al responsable. Refinar = aclarar, no cambiar el
alcance: título que diga QUÉ se logra, descripción "Como… necesito… para…", criterios de aceptación verificables,
y quitar fechas y relleno. Mostrar antes/después y aplicar solo con aprobación.

### Crear una Task (siempre bajo una HU)

```text
Título:       <Verbo en infinitivo> <objeto concreto> - <componente, cliente o frente>
Descripción:  <qué se hizo o se hará, 1–2 frases en pasado si ya está hecha>. Evidencia: <enlace o entregable>.
Horas:        estimación = <real si ya está hecha>; completado = <horas reales>
```

Ejemplos por área (ilustrativos): "Consolidar novedades de nómina de la quincena - Talento Humano",
"Ejecutar pruebas de regresión del flujo de pagos - QA", "Responder solicitudes pendientes del canal de correo -
Soporte", "Ajustar validación de adjuntos en el servicio de radicación - Desarrollo".

### Refinar una Task

Título con verbo + objeto concreto (como sus Tasks hermanas), descripción breve con la evidencia real, horas reales y
estado correcto (planeación / en curso / entregado). Sin fechas, sin inventar trabajo. Preview antes/después y
aprobación.

## Actualizar un item existente

Con `workItemId`, Linky **suma** las horas del día a las que ya tiene la Task (el preview muestra `antes → después`),
**no toca la descripción** (salvo que la actividad traiga `System.Description` explícita, y el preview lo advierte) y
deja el resumen y la evidencia del día como comentario. El cambio lleva la revisión leída en el preview: si alguien
modificó el item entretanto, Azure lo rechaza y no se escribe nada. `stateOnly: true` solo cambia el estado.

## Crear Tasks (campos del proceso)

Al crear, Linky hereda **Iteración y Área de la HU padre**, respeta los defaults del proceso y, para campos
obligatorios propios del equipo (p. ej. `Microsoft.VSTS.Common.Activity`, `Custom.SubActividad`), usa en orden:
valor explícito de la actividad (`fields`) → `azure.taskFieldDefaults` del perfil → valor más usado en las **Tasks
hermanas** de la misma HU. Siempre valida contra los valores permitidos. Si el proceso exige estimación y la tarea
ya está hecha, usa la hora real y lo indica en el preview.

## Horas reales

```bash
npm run linky -- azure hours --date YYYY-MM-DD [--set 558412=2,558413=1,5] [--meetings-task <id>]
npm run linky -- azure hours --apply --approve --snapshot <hash>    # tras el "sí" de la persona
```

Pendiente = jornada − horas ya registradas ese día en Azure − reuniones **confirmadas**. Se reparte solo entre Tasks
que la persona tocó ese día (cambios de estado, comentarios, commits `AB#`), en cuartos de hora. Si no hay Tasks del
día, no reparte: pregunta. Las reuniones confirmadas van a la Task que indique la persona (`--meetings-task`).
El apply revalida que la Task no haya cambiado y usa control de revisión; repetirlo no duplica.

## Sin fechas en descripciones

Las descripciones de HU/Tasks no llevan fechas (la fecha de la Task es su campo). Linky lo valida y su marcador
interno de reconciliación no contiene fechas.

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
Si la persona pide registrar solo parte del día (menos horas), el JSON del día lleva `"partialDay": true`: los huecos quedan avisados y no bloquean.

## Schema

Detectar campos por proceso en runtime. No afirmar ejemplos de usuario “verificados” si la API no se leyó.

## Recordatorios PAT

CLI con reloj/tz local; scheduler OS solo opt-in documental.
