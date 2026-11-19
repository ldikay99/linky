# Linky web

Interfaz web de Linky: un chat con sus herramientas, conectores cifrados, evidencias adjuntas con visor y
dictado por voz. Convive con el CLI y el servidor MCP: usa los mismos comandos y las mismas reglas.

## Arquitectura

| Capa | Decisión | Por qué |
| --- | --- | --- |
| Acceso | Directo en el equipo de la persona (solo loopback, Host validado, cookie segura, CSRF) | El inicio de sesión con cuenta y URL por persona llega con el modo `multi`. |
| Servidor | Node 26 + TypeScript + Fastify 5 | Mismo lenguaje que el CLI (reutiliza sus 30+ herramientas), tipado de punta a punta, rendimiento y un ecosistema de seguridad maduro (helmet, rate-limit). |
| IA | AI SDK (`ai`) con proveedores oficiales | Un solo código para OpenAI, Claude, Gemini, Vertex, Mistral y DeepSeek; se cambia con variables de entorno. |
| Datos | Interfaz `Store` con dos motores: SQLite (`node:sqlite`, por defecto) y PostgreSQL 18 (`pg`, con `DATABASE_URL`) | SQLite: sin servicios extra para una persona. PostgreSQL: servidor del área, con aislamiento por persona (Row Level Security). Mismas rutas, mismo cifrado y migraciones versionadas en los dos. Modelo en `docs/MODELO-DE-DATOS.md`. |
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
                        └── SQLite o PostgreSQL, contenido cifrado (conversaciones, aprobaciones, sesiones)
```

Toda escritura (Azure, Ripor, Google Chat) pasa por preview y una tarjeta de **Aprobar / Rechazar**. El modelo
no puede aprobar: la herramienta de aplicar no se ejecuta sola y el servidor exige que el snapshot coincida con
el preview que la persona vio.

## Contexto y memoria

- **Conversación:** el historial completo se guarda cifrado. Al modelo se envía lo reciente dentro de un presupuesto;
  lo anterior viaja como un resumen que se actualiza solo. Nada se pierde.
- **Memoria de la persona (entre chats):** el asistente guarda lo estable sobre cómo trabaja (etiquetas, a quién
  mencionar, formatos) y lo sigue en cada conversación. La persona la ve, agrega y borra en *Memoria*.
- **Conversaciones anteriores:** cada turno se indexa en fragmentos para que el asistente encuentre "lo que hicimos
  con PQRD". Búsqueda por significado si hay embeddings; si no, por palabras (sin enviar nada a terceros).
- Texto y vectores van cifrados; la memoria rechaza cualquier cosa que parezca una clave o un token.

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
npm run docker:up     # crea la clave maestra y las contraseñas en .secrets/ (fuera de git) y levanta el contenedor
```

Queda en `http://localhost:4780` y se entra directo, publicado solo en el loopback del anfitrión. El contenedor corre sin root,
con sistema de archivos de solo lectura, sin capacidades, y guarda todo en el volumen `linky-data` (cifrado).
Para exponerlo a otras personas: detrás de un proxy TLS con `LINKY_WEB_PUBLIC_URL=https://…`, sin
`LINKY_WEB_ALLOW_HTTP` y con `LINKY_WEB_TENANCY=multi`.

En el contenedor no hay pantalla para la ventana de inicio de sesión de Google y Ripor; esos conectores llegan
con la integración directa de Google Cloud. Azure (token) funciona completo.

## Base de datos: SQLite o PostgreSQL

Sin `DATABASE_URL` la web usa SQLite en su directorio de datos: es lo indicado para una persona en su equipo y no
necesita nada más. Con `DATABASE_URL` usa PostgreSQL: es lo indicado para el servidor del área.

### Migraciones

El esquema está en migraciones versionadas: `server/store/migrations/sqlite/` y `server/store/migrations/postgres/`,
archivos `NNNN_nombre.sql` numerados desde 0001 y con el mismo número de versión en los dos motores. Al arrancar, la
web aplica las pendientes, cada una en su transacción, y las registra en `schema_migrations` (versión, nombre,
huella y fecha). Volver a arrancar no repite nada.

- Una base SQLite creada antes de las migraciones se reconoce sola: la 0001 es el esquema de siempre y no le cambia
  nada; queda registrada y se aplican las siguientes. No hay que hacer nada.
- Una migración ya aplicada no se edita (si su huella cambia, la web no arranca y lo dice): los cambios van en una
  migración nueva, en las dos carpetas.
- Si la base está en una versión más nueva que el código, la web no arranca: hay que actualizar Linky.
- En PostgreSQL un candado de la base evita que dos instancias que arrancan a la vez migren dos veces.

### PostgreSQL local con Docker

```bash
npm run db:up        # crea las contraseñas en .secrets/ (fuera de git), levanta PostgreSQL y espera a que esté sano
npm run db:down      # lo detiene (los datos quedan en el volumen linky-pg-data)
npm run web:test:pg  # todas las pruebas de la web también contra PostgreSQL (lo levanta y lo detiene si no estaba)
```

El servicio `postgres` de `docker-compose.yml` va en el perfil `postgres` (`docker compose up` a secas no lo arranca).
Imagen PostgreSQL 18.7 fijada por digest, publicada solo en `127.0.0.1:5478` (`LINKY_PG_PORT` para cambiarlo), sin
root, sin capacidades, con sistema de archivos de solo lectura, healthcheck y contraseñas por secretos de Docker. La
primera vez crea dos roles:

| Rol | Para qué |
| --- | --- |
| `linky_admin` | Superusuario, solo para mantenimiento. Contraseña en `.secrets/postgres-admin.password`. |
| `linky` | La web y las pruebas. Sin superusuario ni `BYPASSRLS`, así Row Level Security aplica. Dueño de las bases `linky` (desarrollo) y `linky_test` (pruebas). Contraseña en `.secrets/postgres.password`. |

Para correr la web de tu equipo contra ese PostgreSQL (la contraseña nunca va en la URL):

```bash
# bash
DATABASE_URL=postgres://linky@127.0.0.1:5478/linky LINKY_WEB_DATABASE_PASSWORD_FILE="$PWD/.secrets/postgres.password" npm run web:dev
```

```powershell
# PowerShell
$env:DATABASE_URL = "postgres://linky@127.0.0.1:5478/linky"; $env:LINKY_WEB_DATABASE_PASSWORD_FILE = "$PWD\.secrets\postgres.password"; npm run web:dev
```

Para que el contenedor de la web también lo use, en un `.env` junto a `docker-compose.yml` (ignorado por git):

```bash
LINKY_WEB_DATABASE_URL=postgres://linky@postgres:5432/linky?sslmode=disable
LINKY_WEB_DATABASE_ALLOW_PLAINTEXT=1   # la red interna de Compose no sale del anfitrión
```

y luego `docker compose --profile postgres up -d --build`. Los datos de SQLite no se copian solos a PostgreSQL.

### PostgreSQL en un servidor

- Fuera de loopback la conexión va con TLS y verificación completa del certificado y del nombre (`verify-full`),
  aunque la URL no lo diga. `sslmode=require`, `prefer` o `verify-ca` se rechazan; `sslmode=disable` solo con
  `LINKY_WEB_DATABASE_ALLOW_PLAINTEXT=1`. Si el certificado lo firma una autoridad propia, va en
  `LINKY_WEB_DATABASE_CA_FILE`.
- La web debe conectarse con un rol sin superusuario ni `BYPASSRLS` (si no, lo avisa al arrancar): con él,
  cada consulta solo ve las filas de la persona de la petición, aunque el código olvidara filtrar.
- El contenido sigue cifrado por Linky antes de llegar a la base: la clave nunca viaja en las consultas.

## Variables de entorno

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `LINKY_AI_PROVIDER` | `none` | `openai`, `anthropic`, `google`, `vertex`, `mistral` o `deepseek`. Sin proveedor, el chat funciona con acciones directas. |
| `LINKY_AI_MODEL` | según proveedor | Modelo exacto. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY` | | Clave del proveedor elegido. |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` | | Vertex AI (credenciales por ADC de GCP). |
| `LINKY_AI_CONTEXT_CHARS` | `140000` | Presupuesto de contexto por turno; lo más antiguo se resume (el historial completo se conserva). |
| `LINKY_EMBED_PROVIDER` / `LINKY_EMBED_MODEL` | `auto` | Embeddings de la memoria (`openai`, `google`, `vertex`, `mistral`, `none`). Sin ellos, la búsqueda es por palabras. |
| `LINKY_STT_PROVIDER` | `browser` | `openai` para transcribir en el servidor; si no, el dictado del navegador. |
| `LINKY_WEB_TENANCY` | `single` | `multi`: cada usuario con su espacio y bóveda. |
| `LINKY_WEB_MASTER_KEY` / `_FILE` | llavero | Clave maestra (32 bytes base64). Obligatoria en `multi` y en Docker. |
| `LINKY_WEB_SECRET_BACKEND` | `keyring` | `vault` en servidores sin llavero. |
| `LINKY_WEB_PUBLIC_URL` | `http://127.0.0.1:4780` | Origen público (https fuera de loopback). |
| `LINKY_WEB_PORT`, `LINKY_WEB_HOST` | `4780`, `127.0.0.1` | Escucha. |
| `LINKY_WEB_MAX_UPLOAD_MB` | `25` | Tamaño máximo por adjunto. |
| `DATABASE_URL` | | PostgreSQL (`postgres://usuario@servidor:5432/base`). Sin ella, SQLite en el directorio de datos. |
| `LINKY_WEB_DATABASE_PASSWORD_FILE` | | Archivo con la contraseña de la base (secreto de Docker). Tiene prioridad sobre la de la URL. |
| `LINKY_WEB_DATABASE_CA_FILE` | | Certificado (PEM) de la autoridad del servidor PostgreSQL, si no es pública. |
| `LINKY_WEB_DATABASE_ALLOW_PLAINTEXT` | `0` | `1` permite `sslmode=disable` fuera de loopback; solo en una red privada del mismo anfitrión. |
| `LINKY_PG_PORT` | `5478` | Puerto del anfitrión para el PostgreSQL de `docker-compose` (siempre en `127.0.0.1`). |

Nadie configura su IA: el proveedor y la clave los define quien despliega.
