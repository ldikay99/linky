# Permisos PAT mínimos y revocación

## Qué pide Linky

1. **Onboarding / lectura de metadata** — Work Items (Read)
2. **Apply autorizado** — Work Items (Read & Write); Attachments implícitos en el mismo scope de work items
3. El probe **no escribe** work items

## Dónde se guarda (nunca en el repo)

1. **Keyring del SO** (`@napi-rs/keyring`, servicio `linky-azure-devops` / cuenta `pat`)
2. Alternativa **explícita**: `LINKY_SECRET_BACKEND=env` → variable `LINKY_AZURE_PAT`
3. Alternativa **explícita**: `LINKY_SECRET_BACKEND=session` → memoria del proceso

No hay archivo plaintext. Si existe un `azure-pat` legado en disco, elimínalo: Linky se niega a continuar.

## Revocación

1. Azure DevOps → PATs → Revoke
2. Borra la entrada del keyring / quita `LINKY_AZURE_PAT` / cierra la sesión del proceso
3. Nunca regeneres un PAT dentro del repositorio ni de ejemplos


## Cómo crear el PAT (recomendado)

1. Azure DevOps → **User settings** (arriba a la derecha) → **Personal access tokens** → **New Token**.
2. **Organization:** la organización donde trabajas (crea uno por organización).
3. **Expiration:** *Custom defined* → **90 días**. Anota la fecha: Linky te avisa 7 días antes.
4. **Scopes:** **Full access** (permite todo el flujo de Linky). Mínimo aceptable: Work Items (Read & Write).
5. Copia el token y guárdalo con `npm run linky -- azure connect --org https://dev.azure.com/<org>` (te lo pide oculto).

## Scopes

- **Recomendado:** Full access, confirmando una vez su amplitud (`fullAccessAcknowledged`).
- **Mínimo:** Work Items (Read & Write) — suficiente para metadata, apply y attachments.
- Linky **no** puede inspeccionar de forma fiable los scopes ni el expiry a partir del string del PAT; debes informar fechas y elección de scope.
