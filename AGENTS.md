# Linky — instrucciones comunes para cualquier agente

Autor: **Jonathan Contreras**.

1. CLI `npm run linky`
2. Skill: `skills/linky-azure-boards/SKILL.md`
3. `agent/` (eve) opcional

## Secretos y PAT

- Pedir token de forma segura la primera vez; keyring/env/session; nunca plaintext ni repo.
- Expiry/scopes **user-reported**; recordar ≤7 días con tz/reloj del dispositivo.
- Full access solo con ack; recomendar Work Items R/W.
- Nunca copiar tokens del chat a fixtures, git, zip o logs.

## Operación

Una config; preguntar solo faltantes; preview+approval; journal fail-closed; ejemplos solo sintéticos.
