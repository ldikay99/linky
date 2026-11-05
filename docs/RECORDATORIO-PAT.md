# Recordatorio de vencimiento PAT (local)

## Qué hace Linky por defecto

Al ejecutar `npm run linky -- status` (y tras onboarding) muestra días restantes según:

- `expiresOn` **user-reported** (YYYY-MM-DD)
- zona IANA del **dispositivo** (`Intl` / confirmación si el agente es remoto)
- reloj del proceso local (no un servidor Linky)

**No** lee la fecha de vencimiento ni los scopes desde el string del PAT. **No** afirma metadata oficial verificada.

## Aviso a 7 días

Si faltan ≤ 7 días (o ya venció), el CLI emite `patReminder.level = warn_7_days | expired`.

## Recordatorio del SO (opt-in)

`localOsReminderOptIn` es **false** por defecto. Linky **no** instala Task Scheduler / launchd / systemd automáticamente.

Si activas opt-in, tú instalas el scheduler. Sin scheduler activo, **no** hay garantía de aviso mientras la app no corre.

Ejemplos documentales (no auto):

- Windows: `schtasks` diario → `npm run linky -- status`
- Linux: systemd user timer / cron
- macOS: LaunchAgent

Ver también `planLocalOsReminder()` en el CLI status.
