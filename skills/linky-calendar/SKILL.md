---
name: linky-calendar
description: Leer las reuniones del día en Google Calendar (Meet, grabaciones, transcripciones, notas, fotos adjuntas, enlaces) para usarlas como evidencia en Azure DevOps y Ripor. Sin API keys, headless con la sesión de Google de Linky.
---

# Linky — Google Calendar (agnóstico de proveedor)

**Autor:** Jonathan Contreras

Usa la exportación oficial de Google Calendar con la sesión de Google del perfil de Linky (la misma de Chat y Ripor).
Si no hay sesión: `npm run linky -- chat login`.

```bash
npm run linky -- calendar day --date YYYY-MM-DD          # calendario principal de la persona
npm run linky -- calendar day --date YYYY-MM-DD --all-calendars
```

Devuelve por reunión: hora, si es recurrente, enlace de Meet, **adjuntos de Drive** (grabación `video/mp4`,
transcripción y notas `application/vnd.google-apps.document`, chat `text/plain`, **fotos** `image/*`), enlaces de la
descripción, organizador, asistentes y la respuesta de la persona (`ACCEPTED`, `NEEDS-ACTION`…). Las rechazadas y
canceladas no aparecen. `holidays` lista festivos si la persona tiene ese calendario.

## Descargar adjuntos

```bash
npm run linky -- calendar download --date YYYY-MM-DD [--event "<texto>"] [--only-images] [--videos] [--max-mb N]
```

Guarda en `~/.linky/evidence/<fecha>/` (fuera del repo): fotos tal cual, Google Docs (notas, transcripciones)
como PDF, chat como texto. Grabaciones solo con `--videos`. Si un archivo es del organizador y la persona no tiene
permiso, se informa "Sin acceso" (no es un error de Linky). Las **fotos** descargadas van en `evidenceImages` de la
actividad de Azure y se suben como adjunto de la Task.

## Cómo usarlo como evidencia

- **Azure**: para Tasks de reuniones/llamadas, poner en `meetingOrCallLinks` el Meet y, mejor aún, la grabación,
  transcripción o notas; las fotos adjuntas van como enlace de evidencia.
- **Ripor**: puede mencionarse la reunión en la descripción breve; la evidencia sigue siendo un solo enlace
  (HU de Azure, o la grabación/notas si el día fue principalmente esa reunión).
- Priorizar reuniones aceptadas. Las `NEEDS-ACTION` (sin responder) y eventos generales (pausas activas, charlas)
  solo se reportan si la persona confirma que asistió. Nunca inventar asistencia.
