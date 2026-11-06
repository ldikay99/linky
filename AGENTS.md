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
- Full access solo con ack; recomendar Work Items R/W.
- Nunca copiar tokens del chat a fixtures, git, zip o logs.

## Cuentas

- Azure: puede haber varias organizaciones; una es la **principal** (default). Otra solo si el usuario la pide (`azure connect/login/use`).
- Ripor: una sesión por persona (`ripor login`). Navegador solo para login; el resto por petición directa.

## Operación

Una config; preguntar solo faltantes; preview+approval; journal fail-closed; ejemplos solo sintéticos.
