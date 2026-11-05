# Linky

CLI + **skill agnóstica de IA** para onboarding y registro diario en **Azure Boards**.

**Autor:** Jonathan Contreras

Quien clone este repo **no** obtiene acceso Azure de nadie. Cada persona configura su org, proyecto y PAT en su máquina. El perfil no guarda secretos. **Nunca** subas un PAT al repo, historial, zip, logs ni chats.

## Producto (prioridad)

1. **Núcleo CLI** determinista — `npm run linky` (sin IA pagada)
2. **Skill universal** — [`skills/linky-azure-boards/SKILL.md`](skills/linky-azure-boards/SKILL.md) para **cualquier** asistente
3. Adaptador eve en `agent/` — **opcional**

Instrucciones comunes: [`AGENTS.md`](AGENTS.md)

## Setup obligatorio

Proyecto Azure, PAT, ocupación, contexto del proyecto, asignado vs responsable (tag/mención), quién crea/refina HU, horario lun–jue/viernes confirmado y almuerzo preguntado. Sin defaults inventados de proyecto.

Estados por defecto: planeación / en curso / entregado. **Nunca cerrado** salvo intención explícita + aprobación separada.

## Qué resuelve

1. Crear/actualizar **Tasks** (HUs solo si la política lo permite) con descripción corta + evidencias (enlaces + fotos vía Attachments API).
2. Completar el día reusando **una** configuración: pregunta solo faltantes, minutos reales y evidencias reales.
3. Borradores de mensajes de inicio/cierre (no envío automático; **scheduling desactivado** al instalar).

## Requisitos

- Node.js **24+**
- Keyring del sistema (vía `@napi-rs/keyring`) **o** `LINKY_SECRET_BACKEND=env|session` explícito
- PAT propio (ver [docs/PERMISOS-PAT.md](docs/PERMISOS-PAT.md))

## Instalación

```bash
git clone <url-del-repo>
cd linky
npm install
```

## Onboarding (una vez)

```bash
cp examples/synthetic/onboarding.json ./my-onboarding.json
# Edita org/proyecto/políticas. El campo pat NO debe commitearse.
```

### Demo sin Azure real

```bash
npm run linky -- onboarding --answers examples/synthetic/onboarding.json --mock --secret-backend session --data-dir ./.linky-demo
npm run linky -- status --data-dir ./.linky-demo
```

### Secretos y vencimiento

- Preferido: **keyring OS** (`@napi-rs/keyring`)
- Si no hay keyring: `LINKY_SECRET_BACKEND=env` (`LINKY_AZURE_PAT`) o `session` (memoria del proceso)
- **No** hay fallback silencioso a archivo plaintext
- Si existe `~/.linky/secrets/azure-pat` legado, Linky **falla** hasta que lo borres
- Fechas de creación/vencimiento: **user-reported** (Linky no lee expiry/scopes del string PAT)
- Aviso a ≤7 días y estado expired al correr el CLI, usando **hora/zona del dispositivo**
- Full access: opción explícita con ack; recomendado Work Items R/W
- Recordatorio OS: solo opt-in documental (`docs/RECORDATORIO-PAT.md`); no se activa al instalar

## Flujo diario

```bash
npm run linky -- plan --day examples/synthetic/day-plan.json --data-dir ./.linky-demo --mock
npm run linky -- preview --day examples/synthetic/day-plan.json --data-dir ./.linky-demo --mock
npm run linky -- apply --preview "$HOME/.linky/last-preview.json" --approve --by "tu-nombre" --snapshot <hash> --data-dir ./.linky-demo --mock
npm run linky -- reconcile --key "<clientKey>" --data-dir ./.linky-demo --mock
npm run linky -- drafts --day examples/synthetic/day-plan.json --data-dir ./.linky-demo
```

Reglas:

- No inventa horas ni evidencias; no cierra por la hora.
- Separa **Entregado** vs **Cerrado**; políticas se revalidan en apply.
- Journal durable: `pending` antes del request; si la respuesta es incierta → `unknown` y **no** reintenta POST; reconciliar por marcador en Description.
- Adjuntos: upload binario + relación `AttachedFile` en create **y** update.
- `organizationUrl` solo `https://dev.azure.com/{org}` o `https://{org}.visualstudio.com`; fetch con `redirect: error`.

## Skill para cualquier IA

Carga [`skills/linky-azure-boards/SKILL.md`](skills/linky-azure-boards/SKILL.md) en tu asistente. No requiere Grok, ChatGPT, Claude, eve ni Gateway.

## Tests

```bash
npm test
npm run demo:mock
npm run typecheck
```

Todo con **mocks**. No hay E2E Azure real en CI.

## Seguridad

- `.gitignore` excluye `.env`, secretos y `.linky/`
- Ejemplos solo sintéticos (`examples/synthetic/`)
- Revocación PAT: [docs/PERMISOS-PAT.md](docs/PERMISOS-PAT.md)
- Campos: [docs/REFERENCIA-AZURE.md](docs/REFERENCIA-AZURE.md)

## Limitaciones del MVP

- Primer módulo: Azure Boards
- Si el proceso no distingue Entregado/Closed, pide confirmación
- eve chat es opcional y necesita credenciales de modelo si lo usas
- No se validan work items reales en CI

## Licencia / uso

Clonar ≠ acceso Azure. No publiques datos privados de tu organización en forks ni PRs.
