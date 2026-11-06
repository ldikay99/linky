# Linky — instrucciones comunes para cualquier agente

Autor: **Jonathan Contreras**.

1. CLI `npm run linky`
2. Skill: `skills/linky-azure-boards/SKILL.md`
3. `agent/` (eve) opcional

## Bienvenida (al iniciar el onboarding)

Cuando entiendas el proyecto y empieces el onboarding con la persona, ejecuta `npm run linky -- welcome`
y muestra su salida **tal cual, dentro de un bloque de código** (logo Linky y créditos a Jonathan Contreras).
Linky no usa API keys: funciona con el asistente de IA que la persona prefiera.

## Secretos y PAT

- Pedir token de forma segura la primera vez; keyring/env/session; nunca plaintext ni repo.
- Expiry/scopes **user-reported**; recordar ≤7 días con tz/reloj del dispositivo.
- Al crear el PAT recomendar **Full access** y **90 días** de vigencia (permite todo el flujo); confirmar una vez la amplitud (ack). Mínimo aceptable: Work Items Read & Write.
- Nunca copiar tokens del chat a fixtures, git, zip o logs.

## Cuentas

- Azure: puede haber varias organizaciones; una es la **principal** (default). Otra solo si el usuario la pide (`azure connect/login/use`).
- Ripor: una sesión por persona (`ripor login`). Navegador solo para login; el resto por petición directa. Si vence, se renueva sola.
- Google Chat: `chat login` (una vez) y el chat de reporte elegido por la persona. Mensajes solo con borrador + aprobación (`skills/linky-chat`).
- Google Calendar: `calendar day` con la misma sesión de Google; reuniones, grabaciones, notas y fotos como evidencia (`skills/linky-calendar`).
- Un solo perfil de navegador de Linky para Google, Ripor, Chat y Calendar (fuera del repo): la persona inicia sesión en Google una vez (`google login`). Para rotar esa sesión: `google logout` + `google login`.

## Empezar rápido

- `npm run linky -- doctor`: estado de todo y el arreglo exacto de cada problema. Úsalo antes de diagnosticar a mano.
- `npm run linky -- day [--date …] [--all]`: todo el día en una llamada (Azure, reuniones, Ripor, borradores de chat, siguientes pasos).

## Contribuir

Si un ajuste sirve a todos (bug o ampliación, no configuración personal), hazlo con tests y, con aprobación de la
persona, ejecuta `npm run contribute` (rama `contrib/<usuario>/<tema>` + PR). Ver `CONTRIBUTING.md`.

## Operación

Una config; preguntar solo faltantes; preview+approval; journal fail-closed; ejemplos solo sintéticos.
