---
name: linky-chat
description: Publicar los mensajes de inicio y cierre de jornada en el chat de Google Chat que la persona eligió, con borrador y aprobación. Headless tras un único login.
---

# Linky — Google Chat (agnóstico de proveedor)

**Autor:** Jonathan Contreras

Google Chat no ofrece API de usuario sin un proyecto Cloud/OAuth propio, así que Linky usa el **perfil de navegador
compartido de Linky** (fuera del repo): login visible una vez y después todo **headless**. La misma sesión de Google
sirve para Ripor ("Iniciar con Google").

## Onboarding (una vez)

1. `npm run linky -- chat login` → la persona inicia sesión en Google, **abre el chat donde reporta** y **cierra la ventana** estando dentro.
2. `npm run linky -- chat read` → confirmar con la persona que es el chat correcto (muestra los últimos mensajes).
3. Con permiso de la persona, usar sus mensajes anteriores de inicio/cierre como referencia de formato y largo. Nunca escribir de más.

## Enviar (siempre con aprobación)

```bash
npm run linky -- chat draft --text "<mensaje>"          # o --file <ruta>; muestra el texto y su hash
npm run linky -- chat send --draft <out> --approve --snapshot <hash>
```

- Mostrar el texto EXACTO a la persona y enviar solo tras su "sí/envíalo".
- Solo al chat configurado; si el usuario pide otro, repetir `chat login`.
- `send` verifica que el mensaje apareció. Un mismo borrador no se envía dos veces; si quedó incierto, revisar con `chat read` antes de `--resend`.
- Corto: tope 600 caracteres por defecto.
