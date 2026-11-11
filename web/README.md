# Linky web

Interfaz web de Linky: un chat con sus herramientas, conectores cifrados, evidencias adjuntas con visor y
dictado por voz. Convive con el CLI y el servidor MCP: usa los mismos comandos y las mismas reglas.

## Arquitectura

| Capa | Decisión | Por qué |
| --- | --- | --- |
| Acceso | Directo en el equipo de la persona (solo loopback, Host validado, cookie segura, CSRF) | El inicio de sesión con cuenta y URL por persona llega con el modo `multi`. |
| Servidor | Node 24 + TypeScript + Fastify 5 | Mismo lenguaje que el CLI (reutiliza sus 30+ herramientas), tipado de punta a punta, rendimiento y un ecosistema de seguridad maduro (helmet, rate-limit). |
| IA | AI SDK (`ai`) con proveedores oficiales | Un solo código para OpenAI, Claude, Gemini, Vertex, Mistral y DeepSeek; se cambia con variables de entorno. |
| Datos | SQLite (`node:sqlite`) detrás de la interfaz `Store` | Sin dependencias nativas; al escalar se cambia por Postgres/Cloud SQL sin tocar rutas. |
| Cifrado | AES-256-GCM, clave por persona y propósito (HKDF) | Conversaciones, títulos, adjuntos y aprobaciones cifrados; el id del registro va como AAD. |
| Secretos de Linky | Llavero del sistema o bóveda cifrada (`LINKY_VAULT_KEY`) | En el equipo, el llavero de siempre; en servidores y Docker, una bóveda por persona. |
| Cliente | React 19 + Vite, CSS propio | Sin framework de estilos: paleta, tipografía (Inter, JetBrains Mono), iconos y scrollbars propios; no depende del tema del sistema. |
| Python | Fuera del núcleo | Puede sumarse como servicio aparte donde aporte (p. ej. procesamiento de documentos), nunca como backend. |

```
navegador ──HTTPS──► Fastify (CSP estricta, CSRF, rate-limit, sesión httpOnly)
                        │
                        ├── chat (SSE) ──► AI SDK ──► proveedor configurado
                        │        └── herramientas ──► Linky CLI (proceso hijo por persona, sin zombis)
                        ├── adjuntos ──► validación por contenido ──► disco cifrado
                        └── SQLite cifrado (conversaciones, aprobaciones, sesiones)
```

Toda escritura (Azure, Ripor, Google Chat) pasa por preview y una tarjeta de **Aprobar / Rechazar**. El modelo
no puede aprobar: la herramienta de aplicar no se ejecuta sola y el servidor exige que el snapshot coincida con
el preview que la persona vio.

## Usarla en tu equipo

```bash
npm ci && npm run web:install   # una vez
npm run web                     # compila y abre http://127.0.0.1:4780 (se entra directo)
npm run web:dev                 # desarrollo con recarga
npm run web:test                # pruebas
```

En modo `single` (por defecto) la web usa tu Linky de siempre: lo que ya conectaste en el CLI aparece conectado.

## Docker

```bash
npm run docker:up     # crea la clave maestra en .secrets/ (fuera de git) y levanta el contenedor
```

Queda en `http://localhost:4780` y se entra directo, publicado solo en el loopback del anfitrión. El contenedor corre sin root,
con sistema de archivos de solo lectura, sin capacidades, y guarda todo en el volumen `linky-data` (cifrado).
Para exponerlo a otras personas: detrás de un proxy TLS con `LINKY_WEB_PUBLIC_URL=https://…`, sin
`LINKY_WEB_ALLOW_HTTP` y con `LINKY_WEB_TENANCY=multi`.

En el contenedor no hay pantalla para la ventana de inicio de sesión de Google y Ripor; esos conectores llegan
con la integración directa de Google Cloud. Azure (token) funciona completo.

## Variables de entorno

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `LINKY_AI_PROVIDER` | `none` | `openai`, `anthropic`, `google`, `vertex`, `mistral` o `deepseek`. Sin proveedor, el chat funciona con acciones directas. |
| `LINKY_AI_MODEL` | según proveedor | Modelo exacto. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY` | | Clave del proveedor elegido. |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` | | Vertex AI (credenciales por ADC de GCP). |
| `LINKY_STT_PROVIDER` | `browser` | `openai` para transcribir en el servidor; si no, el dictado del navegador. |
| `LINKY_WEB_TENANCY` | `single` | `multi`: cada usuario con su espacio y bóveda. |
| `LINKY_WEB_MASTER_KEY` / `_FILE` | llavero | Clave maestra (32 bytes base64). Obligatoria en `multi` y en Docker. |
| `LINKY_WEB_SECRET_BACKEND` | `keyring` | `vault` en servidores sin llavero. |
| `LINKY_WEB_PUBLIC_URL` | `http://127.0.0.1:4780` | Origen público (https fuera de loopback). |
| `LINKY_WEB_PORT`, `LINKY_WEB_HOST` | `4780`, `127.0.0.1` | Escucha. |
| `LINKY_WEB_MAX_UPLOAD_MB` | `25` | Tamaño máximo por adjunto. |

Nadie configura su IA: el proveedor y la clave los define quien despliega.
