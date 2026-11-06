# Linky — instrucciones comunes para cualquier agente

Autor: **Jonathan Contreras**.

Linky registra el día de trabajo de la persona en **Azure DevOps**, **Ripor** y **Google Chat**, con evidencias de
Calendar, Gmail y (si desarrolla) sus commits/PRs. Es un CLI local + skills + servidor MCP; no usa API keys y
funciona con el asistente de IA que la persona prefiera.

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

1. `azure connect --org <url> --primary` (PAT oculto; recomendar Full access + 90 días). Más organizaciones con su
   propio PAT. El vencimiento NO se le pregunta a la persona: Linky lo lee del correo que Azure envía al crear el token
   (`azure expires --from-mail`), y si no hay correo lo detecta cuando el token deja de funcionar.
   Luego `onboarding --answers <json>` con datos REALES de la persona.
2. `google login` (una vez): habilita Chat, Calendar, Gmail y el login de Ripor con Google.
3. `ripor login` → `ripor catalog --from-date <día ya reportado>` → `ripor setup` (proyecto de ÁREA ≠ proyectos Azure).
4. `chat login` (chat de reporte) y `chat template` según cómo reporta su área.
5. `calendar meetings`: preguntar cuáles eventos son reuniones de trabajo (`calendar confirm|ignore --title`).
6. Si desarrolla: `dev scan --root <carpeta>` y quitar repos personales con `dev remove`.
7. `doctor` para confirmar que todo quedó en verde.

## Uso diario

- `doctor`: estado y arreglo exacto de cada problema. Úsalo antes de diagnosticar a mano.
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

## Contribuir

Si un ajuste sirve a todos (bug o ampliación, no configuración personal), hazlo con tests y, con aprobación de la
persona, ejecuta `npm run contribute` (rama `contrib/<usuario>/<tema>` + PR). Ver `CONTRIBUTING.md`.
