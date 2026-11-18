# Inventario de fuentes de datos

Fuentes que Linky lee o escribe para registrar el día de cada persona: cómo se conecta a cada una, qué toma, qué
escribe y qué guarda. Es la base para el modelo de datos en PostgreSQL y para la clasificación de datos sensibles
(`DATOS-SENSIBLES.md`).

## Resumen

| Fuente | Conexión | Lee | Escribe | Obligatoria |
|---|---|---|---|---|
| Azure DevOps | API REST con token personal (PAT) | HU, Tasks, campos, estados, horas, PRs | Tasks, HU, horas, estados, comentarios, fotos | Sí |
| Google Calendar | Exportación oficial del calendario con la sesión de Google | Eventos del día | — | Sí |
| Gmail | Gmail web con la sesión de Google, solo lectura | Correos del día (asunto, personas, hora, fragmento) | — | No |
| Ripor | Formulario de horas por HTTP con la sesión de Ripor | Catálogo y reportes del mes | Reporte diario | Sí |
| Git y Azure Repos | `git` sobre los repositorios locales + API de Azure para PRs | Commits y PRs del día | — | Solo si la persona desarrolla |
| Google Chat | Chat web con la sesión de Google | Mensajes del chat de reporte | Inicio y cierre de jornada | No |
| Proveedor de IA | API del proveedor fijado por variables de entorno | — | Conversación y adjuntos que la persona envía | Sí (web) |

## Detalle por fuente

### Azure DevOps

- **Conexión:** `https://dev.azure.com/<organización>` con el PAT de la persona (autenticación Basic). Como alternativa,
  la cookie de la sesión web. Una o varias organizaciones; una es la principal.
- **Lee:** work items (HU y Tasks), campos que usa el equipo, estados permitidos, iteraciones, horas estimadas y
  completadas, PRs creados o cerrados por la persona.
- **Escribe:** crea y actualiza Tasks (y HU si la política del equipo lo permite), horas, estados, comentarios con
  mención y fotos de evidencia. Toda escritura pasa por preview y aprobación.
- **Credencial:** llavero del sistema, servicio `linky-azure-devops`, una entrada por organización. La cookie, en
  `linky-azure-web`.
- **Guarda:** `azure-orgs.json` (organizaciones y vencimiento del token), `azure-style.json` (formato aprobado de
  HU y Tasks).
- **Vencimiento del token:** se lee del correo que Azure envía al crearlo y se avisa siete días antes.

### Google Calendar

- **Conexión:** exportación oficial del calendario (archivo ICS en ZIP) con la sesión de Google del navegador de
  Linky, sin ventana. El ZIP se lee en memoria y se borra.
- **Lee:** de los eventos del día, título, horario, respuesta de la persona, asistentes, lugar, enlace de reunión y
  adjuntos o enlaces de la descripción.
- **Guarda:** `calendar.json`, solo la clasificación que la persona hizo de cada título (reunión de trabajo o
  evento general).
- **Riesgo conocido:** la exportación falla por tiempo de espera algunos días. La solución es la API oficial de
  Calendar con OAuth.

### Gmail

- **Conexión:** Gmail web con la misma sesión de Google, sin ventana. Solo lectura.
- **Lee:** correos enviados del día (y recibidos si la persona lo pide): asunto, personas, hora, fragmento y enlace
  al hilo. Además, el correo de Azure con el vencimiento del token.
- **Guarda:** nada; el cuerpo completo de los correos no se descarga.

### Ripor

- **Conexión:** formulario de horas (`ripor.co/u/horas`) por HTTP con las cookies de la sesión de Ripor, que se
  abre una vez con la cuenta de Google.
- **Lee:** catálogo (proyecto de área, tareas, modalidad) y los reportes del mes para saber qué días faltan.
- **Escribe:** el reporte de cada día laborable con sus horas, descripción y evidencia, con preview y huella del
  contenido aprobado.
- **Credencial:** llavero, servicio `linky-ripor`.
- **Guarda:** `ripor-profile.json` (configuración), `ripor-journal.json` (registro de lo enviado para reconciliar
  sin duplicar).

### Git y Azure Repos

- **Conexión:** `git` sobre los repositorios locales que la persona registró. Los PRs, por la API de Azure con el
  mismo PAT. Las URLs de los remotos se limpian de credenciales incrustadas.
- **Lee:** commits del día de los correos de la persona y PRs creados o cerrados ese día.
- **Guarda:** `dev.json` (rutas de los repositorios y correos de autor).

### Google Chat

- **Conexión:** Chat web con la sesión de Google. Solo para las áreas que reportan inicio y cierre de jornada.
- **Lee y escribe:** el chat de reporte elegido por la persona; el mensaje sale con preview y aprobación.
- **Guarda:** `chat.json` (chat elegido y plantilla), `chat-sent.json` (mensajes enviados, para no repetir).

### Proveedor de IA

- **Conexión:** API del proveedor configurado en el servidor (OpenAI, Claude, Gemini, Vertex, Mistral o DeepSeek).
  La persona no configura nada.
- **Recibe:** los mensajes de la conversación, los adjuntos que la persona envía y los resultados de las
  herramientas de Linky en ese turno.
- **Guarda en el proveedor:** según su política; en Linky solo queda el historial cifrado de la conversación.

## Datos propios de Linky

| Dónde | Qué | Uso |
|---|---|---|
| `~/.linky` (fuera del repositorio) | `profile.json`, previews (`last-*.json`), `idempotency.json` | Perfil y jornada de la persona, últimas vistas previas y control de duplicados |
| Llavero del sistema o bóveda cifrada (`vault.json`) | Tokens y cookies | Credenciales de Azure, Ripor y Google |
| Base de datos de la web (hoy SQLite, pasa a PostgreSQL) | Usuarios, sesiones, conversaciones, adjuntos, memoria, aprobaciones, auditoría | Interfaz web multiusuario |
| Carpeta de adjuntos de la web | Archivos cifrados uno a uno | Evidencias que la persona adjunta en el chat |
