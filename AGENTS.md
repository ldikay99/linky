# Linky — instrucciones comunes para cualquier agente

Autor: **Jonathan Contreras**.

Linky registra el día de trabajo de la persona en **Azure DevOps** y **Ripor**, con evidencias de Calendar y Gmail.
Opcionales según su área: mensajes de inicio/cierre en **Google Chat** y, si desarrolla, sus commits/PRs. Lo usan
áreas de todo tipo, no solo programadores: no asumas rol, formato de reporte ni que desarrolla. Es un CLI local +
skills + servidor MCP; no usa API keys y funciona con el asistente de IA que la persona prefiera.

- Con MCP (recomendado): el repo ya trae la configuración (`.mcp.json`, `.vscode/mcp.json`). Al abrir la carpeta, el
  cliente detecta el servidor `linky`; si pide aprobarlo, apruébalo tú (la IA) en la configuración local del proyecto.
  Si el cliente no lee esa configuración, ejecuta `npm run linky -- mcp-config` y regístralo tú en el cliente. La persona
  no debe copiar ni pegar nada.
- Sin MCP: `npm run linky -- <comando>` (salida JSON).
- Skills: `skills/linky-azure-boards`, `linky-ripor`, `linky-calendar`, `linky-mail`, `linky-chat`, `linky-dev`.

## Bienvenida (al iniciar el onboarding)

Cuando entiendas el proyecto y empieces el onboarding con la persona, ejecuta `npm run linky -- welcome`
(o la herramienta `linky_welcome`) y muestra su salida **tal cual, dentro de un bloque de código** (logo Linky y
créditos a Jonathan Contreras).

## Onboarding (en este orden; preguntar solo lo que falte)

0. Si no existe `node_modules`, ejecuta `npm install` (sin eso no arrancan el CLI ni el servidor MCP).

1. `azure connect --org <url> --primary` (PAT oculto; recomendar Full access + 90 días). Más organizaciones con su
   propio PAT. El vencimiento NO se le pregunta a la persona: Linky lo lee del correo que Azure envía al crear el token
   (`azure expires --from-mail`), y si no hay correo lo detecta cuando el token deja de funcionar.
   Luego `onboarding --answers <json>` con datos REALES de la persona.
2. `google login` (una vez): habilita Chat, Calendar, Gmail y el login de Ripor con Google.
3. `ripor login` → `ripor catalog --from-date <día ya reportado>` → `ripor setup` (proyecto de ÁREA ≠ proyectos Azure).
4. Opcional: preguntar si su equipo reporta inicio/cierre de jornada en Google Chat. Solo si dice que sí:
   `chat login` (chat de reporte) y `chat template` según cómo reporta su área. Si no, saltar este paso.
5. `calendar meetings`: preguntar cuáles eventos son reuniones de trabajo (`calendar confirm|ignore --title`).
6. Opcional, si desarrolla: `dev scan --root <carpeta>` y quitar repos personales con `dev remove`.
7. `doctor` para confirmar que todo quedó en verde (chat y desarrollo son opcionales: no lo hacen fallar).

## Uso diario

- `doctor`: estado y arreglo exacto de cada problema. Úsalo antes de diagnosticar a mano. Si avisa que hay
  cambios nuevos de Linky, propón a la persona `git pull && npm install` (arreglos y mejoras) y hazlo con su sí.
- `alerts`: avisos proactivos (Ripor pendiente hoy/mes, PAT por vencer, Tasks estancadas, eventos sin clasificar).
- `day [--date …] [--all] [--mail]`: todo el día en una llamada.
- `ripor month [--suggest]`: días laborables pendientes del mes; `ripor preview --auto --date …` para cada uno.
- `azure hours [--set id=h] [--meetings-task id]`: propuesta de horas reales por Task.

## Reglas que no se rompen

- **Aprobación**: toda escritura (Ripor, Azure, Chat) va con preview → mostrar a la persona → aplicar con su "sí"
  (`--approve` + hash). Nunca saltar el preview.
- **No inventar**: ni horas, ni tareas, ni reuniones, ni evidencias. Si falta información, preguntar.
- **Sin fechas en descripciones** (Ripor y Azure): la fecha va solo en su campo. Linky lo bloquea.
- **Jornada**: lunes a jueves 8,5 h, viernes 8 h. Festivos de Colombia, sábados y domingos no se exigen ni se llenan;
  si la persona trabajó un fin de semana y lo pide, se respeta. Menos horas solo si la persona lo pide para esa fecha.
- **Reuniones**: solo las que la persona confirmó (`calendar confirm`). Eventos generales (pausas, charlas) no cuentan.
- **HU y Tasks**: no asumir el estilo. Si `azure style` no tiene uno aprobado, antes de la primera HU/Task proponer
  el formato (de sus HU/Tasks anteriores o, si no hay, de las plantillas de `skills/linky-azure-boards`, que sirven
  para cualquier área), mostrarlo y guardarlo con su aprobación (`azure style --kind hu|task …`). Luego reutilizarlo.
  Antes de crear o refinar, `azure fields` muestra cada campo que su equipo llena: proponer valor para todos (o
  preguntarlo), no solo título y descripción. Nada de lo que se escribe en Azure menciona a Linky.
  Toda Task bajo una HU; crear o refinar HU solo si su política lo permite (si no, se pide al responsable).
- **Organizaciones**: la principal por defecto; otra solo si la persona la pide.
- **Sin procesos zombis**: Linky cierra sus navegadores al terminar o si se interrumpe. Si `doctor` o `alerts` reportan
  navegadores huérfanos, ejecutar `cleanup` (solo toca el perfil de Linky). No dejar procesos propios corriendo.
- **Incertidumbre = parar**: si una escritura queda incierta, reconciliar (`ripor reconcile`, revisar Azure) antes de
  repetir. Nunca reintentar a ciegas.

## Secretos y PAT

- Pedir el token de forma segura (entrada oculta); keyring/env/session; nunca plaintext ni repo.
- Si la persona pega un token en el chat, guardarlo con `azure connect` (vía `LINKY_AZURE_PAT_INPUT`, nunca a archivos).
- Vencimiento: se obtiene del correo de Azure ("personal access token added", fecha en formato mes/día/año) o con
  `--expires` si la persona lo sabe. Linky avisa ≤7 días antes y si el token deja de funcionar. Explícalo simple:
  "es la fecha en que el token deja de servir; te aviso antes para que crees otro".
- Nunca copiar tokens, cookies ni datos personales a fixtures, git, zip, logs o al repo.

## Interfaz web

`web/` es la misma Linky con interfaz de chat (Fastify + React, ver `web/README.md`). Usa estas mismas reglas y
herramientas; las escrituras se aprueban con botones y el proveedor de IA se fija por variables de entorno.
Cambios en `agent/` deben mantener funcionando el CLI, el MCP y la web (`npm test` y `npm run web:test`).

## Contribuir

Si un ajuste sirve a todos (bug o ampliación, no configuración personal), hazlo con tests y, con aprobación de la
persona, ejecuta `npm run contribute` (rama `contrib/<usuario>/<tema>` + PR). Ver `CONTRIBUTING.md`.
