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

4. **Formato del área**: mostrar el formato por defecto con `npm run linky -- chat template` y preguntar a la persona
   cómo reporta su equipo. Ajustarlo, por ejemplo:
   `chat template --inicio "Hola equipo, hoy {fecha}:\n{tareas}" --cierre "Cierre {fecha}\nListo: {entregadas}\nSigue: {en_curso}" --item "- {titulo} (#{id})"`
   Marcadores: `{fecha}` `{tareas}` `{entregadas}` `{en_curso}`; por línea `{id}` `{titulo}` `{estado}` `{url}`; `\n` = salto de línea.

## Inicio y cierre de jornada

```bash
npm run linky -- chat draft --inicio                 # Tasks abiertas de la persona (en curso primero, luego planeación)
npm run linky -- chat draft --cierre [--date …]      # entregadas/cerradas ese día + lo que sigue en curso
```

Salen de Azure (organización principal o `--org`), clasificando estados por categoría del proceso. Si el texto pasa
del tope, Linky acorta títulos y agrupa ("… y N más") conservando los números de Task. La IA puede pulir el texto
(`--text`), pero sin agregar trabajo que no esté en Azure.

## Enviar (siempre con aprobación)

```bash
npm run linky -- chat draft --text "<mensaje>"          # o --file <ruta>; muestra el texto y su hash
npm run linky -- chat send --draft <out> --approve --snapshot <hash>
```

- Mostrar el texto EXACTO a la persona y enviar solo tras su "sí/envíalo".
- Por defecto, al chat de reporte. Para escribir a otra conversación (p. ej. pedir una HU al líder) usar
  `chat draft --file <texto> --to <url de esa conversación>`; el destino queda en el hash y requiere la misma aprobación.
- `send` verifica que el mensaje apareció. Un mismo borrador no se envía dos veces; si quedó incierto, revisar con `chat read` antes de `--resend`.
- Corto: tope 600 caracteres por defecto.
