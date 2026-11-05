# Navegador local instalable con cualquier IA compatible

## Lo que se entrega (y lo que no)

Linky no es un servicio cloud/chat, ni exporta el plugin de Grok Bot. Cualquier IA con
acceso a un **cliente MCP local stdio**, las herramientas autorizadas y la skill puede
instalar esta configuración en **el dispositivo de la persona**. Un chatbot sin MCP ni
herramientas locales no puede usarla directamente. El esquema exterior del cliente varía.

- Núcleo determinista: `npm run linky` (Node 24 y `npm ci`).
- Navegador: servidor público `@playwright/mcp`, iniciado por el cliente MCP destinatario.
- Azure: PAT en keyring/env/session → **REST oficial Azure WIT**. Con PAT válido NO
  pedir navegador Azure para leer tareas. Ripor usa solo UI con sesión local dedicada.
- No exportar storage, cookies, tokens, contraseñas, trace/session ni HAR. El perfil
  del navegador conserva su estado autenticado PRIVADAMENTE; Linky no lee esos archivos.

## Setup sin efectos sobre clientes ni navegador

```sh
npm run linky -- browser setup
npm run linky -- browser status
```

Opcional `--data-dir /ruta/privada/fuera/del/repo`. Se resuelven symlinks y se rechaza
una ruta dentro del repo, incluso ejecutando desde otro cwd. Nada se instala, abre o
conecta. No se cambia ningún servidor MCP ni sesión existente.

Se generan con permisos privados, sin sobrescribir configuraciones anteriores:

- `~/.linky/browser-setup/playwright-headed.json`
- `~/.linky/browser-setup/playwright-headless.json` (alternativa, NO activada)
- `~/.linky/browser-setup/mcp.generic.json` (`mcpServers`, stdio)
- `~/.linky/browser-setup/mcp.vscode.json` (`servers`, type stdio)

Ambas variantes apuntan al **mismo perfil dedicado**:
`~/.linky/browser-profiles/ripor`. No apuntar a un perfil Chrome personal ni a la sesión
del bot actual. Los outputs automáticos quedan fuera del repo, en `browser-output`.

## Qué instala/ejecuta la persona (no ejecutado por este build)

1. Revisar e importar MANUALMENTE la configuración apropiada en el cliente local.
   Cursor, Claude Desktop, Cline y otros admiten `mcpServers`; VS Code usa `servers`.
   Clientes TOML (p.ej. Codex/Grok CLI) requieren adaptar el server `command/args` a su
   esquema oficial. No asumir que el plugin de Grok Bot comparte ese esquema.
2. Al habilitar el servidor se ejecuta `npx -y @playwright/mcp@latest --config <ruta>`.
   Esto descarga/ejecuta el paquete npm. **latest cambia**: revisar y fijar una versión
   tras validarla. No hay dependencia Playwright ni SDK añadida a `package.json` de Linky.
3. Si falta Chromium, en ese dispositivo ejecutar explícitamente:
   `npx playwright install chromium`. Usar versión compatible con el MCP seleccionado;
   fijar también esa versión si se fija MCP. Descarga binarios (cientos de MB), no abre
   navegador. No ejecutar `install-deps` ni instalar Chrome global silenciosamente.
   En Linux pueden hacer falta dependencias OS; revisarlas/aprobarlas por separado.
4. No activar capacidades `storage`, `network`, `devtools`, scripts init, CDP, extensión,
   puertos HTTP, `--no-sandbox` o acceso de archivos irrestricto. El cliente debe denegar
   `browser_run_code_unsafe`, `browser_evaluate`, herramientas de red/storage/cookies.
   **Core MCP no es sandbox** y puede exponer herramientas peligrosas aunque no haya caps
   opcionales; la allowlist de Linky NO restringe otras llamadas que haga el cliente.

## Login y persistencia, sin promesas falsas

- El primer acceso, si no hay sesión, necesita modo **headed** y pantalla local.
  La persona realiza login/MFA; la IA no pide credenciales en el chat ni las extrae.
- Si hay sesión, usarla; no repetir login innecesariamente.
- Un perfil solo admite **un navegador a la vez**. Parar/cerrar el servidor antes de
  cambiar cliente o modo. Un perfil bloqueado no se copia ni se fuerza.
- Headless es una opción de **arranque**. Para probarlo, cerrar servidor y cambiar la
  ruta `--config` del cliente a `playwright-headless.json`, preservando el perfil.
  No habilitar ambos servidores a la vez. No hay switch en caliente garantizado.
- Persistencia NO significa login eterno: expiración, revocación, MFA y políticas pueden
  exigir reautenticación headed. Headless cross-restart en Ripor **no validado** aquí.

## Interfaz pública y adaptador funcional limitado

`agent/lib/browser/mcpAdapter.ts` acepta un cliente **ya autorizado/conectado** que
implemente las funciones públicas MCP `listTools()` y `callTool({name, arguments})`.
Compatible estructuralmente con el Client del SDK MCP; no se inicia transport desde Shell.
La IA anfitriona puede inyectar el cliente o llamar los mismos tools públicos siguiendo
la skill. Los nombres prefijados por cliente se mapean en ese puente, no se adivinan.

Operaciones implementadas (unit tests; no live test en este build):

- `openPublicPage`: `browser_navigate` únicamente a `https://ripor.co/u/horas`.
- `ensureSession`: snapshot + marcadores positivos UI; desconocido no implica autenticado.
- `observeForm`: roles/nombres/refs de snapshot en memoria (no guarda PII ni screenshots).
- `observeOptions`: nuevo snapshot → control único → click solo combobox → snapshot fresco
  de opciones. Discover schema `target`/`ref`; ambigüedad = error, no ref/ID hardcodeado.
- Para proyecto con label ambiguo `Insertar`, **falla**: la IA debe inspeccionar containing
  label con tools autorizados y elegir por contexto. No sustituye opciones por ejemplos.

NO implementado/NO presentado como éxito: parser completo de reportes con fecha/ID/horas,
confirmaciones guardar/eliminar, ni `applyUiAction` live. Esas funciones arrojan error
explícito. Un preview live con reportes desconocidos queda bloqueado; no supone lista vacía.
`ripor apply --mock` sigue siendo SOLO simulación, no producción.

## Recorrido guiado con gates reales (sin mocks)

1. IA usa tools UI autorizados. Re-snapshot; escoger proyecto de área (distinto de proyectos
   Azure), tarea y transporte desde opciones reales; verificar lista COMPLETA del día.
2. Guardar observación y propuesta en JSON privado fuera del repo, esquema
   `UiCheckInput` en `agent/lib/ripor/uiCheck.ts`. Ejemplo SOLO sintético:
   `examples/synthetic/ripor-ui-check.json`. No copiar datos privados al repo.
3. Ejecutar `npm run linky -- ripor check --input <json-privado>`.
   Valida horas, existentes, cobertura/under, opciones, evidencia sintáctica, fecha e IDs.
   Muestra before/after y hash; NO abre navegador ni muta.
4. Obtener aprobación ESPECÍFICA del usuario para operación + fecha + ID + contenido/hash.
   Releer la UI por cambios; actualizar JSON; ejecutar:
   `npm run linky -- ripor gate --input <json> --approve --by <persona> --snapshot <hash>`.
   Delete además `--delete-confirmed`; requiere petición explícita previa fecha+ID.
   Cualquier cambio material invalida hash. Gate SOLO valida: NO es submit ni prueba de éxito.
5. Solo la IA con permiso realiza acción UI guiada. Para eliminar, gate y aprobación antes de confirmar Continuar en el diálogo. **Editar y crear: Continuar GUARDA DIRECTAMENTE**;
   el gate/aprobación debe estar ANTES del click. No esperar segunda confirmación ni toast.
6. Reabrir/releer UI y reconciliar una sola vez; timeout/resultado incierto = detenerse,
   no repetir guardar, no delete+create como corrección. Registrar el estado pending/unknown
   en journal privado antes de mutar usando el núcleo; no hay transacción automática que
   pueda imponer ese flujo a una IA que opere tools fuera del adaptador.

`coverageProof`, las horas y `complete` son afirmaciones revisables de la IA/persona:
NO prueban criptográficamente el trabajo ni acceso a la web. El gate no puede validar
por sí mismo que un enlace redirija al trabajo correcto; la IA debe observarlo y revisarlo.
No presentar comprobación sintáctica de URL como comprobación de destino.

## Últimas observaciones genéricas UI

- Editar: proyecto combobox ambiguo Insertar (`#project-input` observado, no selector único
  garantizado); horas spinbutton; descripción Inserte; evidencia Insertar singleline.
- Tarea: **Tarea Personalizada**; transporte ejemplo: **🏠 Trabajo Remoto**.
- Editar **Continuar guarda directamente**; reopen confirmó persistencia en prueba parent.
  Sin toast ni confirmación extra. Las mutaciones automáticas siguen deshabilitadas.
- Crear: modal **Registro de Actividades**, inicialmente proyecto/centro de costos, tarea,
  descripción, evidencia; Cancelar/Continuar. Horas/transporte no inicialmente visibles.
  Marcar checkbox **Tarea Personalizada** revela horas; transporte también aparece y filtra texto.
  **Un Continuar guarda directamente**, sin wizard posterior.
- Borrar: X de la fila → confirmación **¿Estás seguro que deseas eliminar este registro?** →
  **Continuar confirma el borrado** (aprobación específica antes). Comprobar ausencia antes de
  recrear, únicamente cuando esa recreación también fue autorizada.
- Ciclo **manual IA con herramientas GUI** edit → delete → create → reopen verificado por parent.
  No equivale a selectores Playwright estables ni a adapter automático de mutaciones operativo.
- Tras crear: comprobar **un solo reporte** del día; reabrir lápiz y comparar proyecto, tarea,
  horas, descripción, evidencia y transporte. Esperar estabilización (GUI puede tardar segundos);
  nunca seguir mientras se escribe. Verificar URL completa tras input.
- Evidencia: **una URL** verificada. Multi-URL en campo UI NO confirmado.
- Lápiz/X sin nombre: fresh snapshot y contexto de fila, no IDs/refs estáticos.

## Fuentes oficiales consultadas (5 nov 2026, America/Bogota)

- https://github.com/microsoft/playwright-mcp (configuración, stdio, tools/schemas, seguridad)
- https://playwright.dev/mcp/configuration/user-profile (perfil persistente y exclusión mutua)
- https://playwright.dev/docs/browsers (instalar binarios, compatibilidad por versión)

Los defaults de paths cambian entre versiones/docs: Linky fija `userDataDir` explícito.
