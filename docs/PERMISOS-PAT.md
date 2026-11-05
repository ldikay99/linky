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


## Scopes recomendados vs Full access

- **Recomendado:** Work Items (Read & Write) — suficiente para metadata, apply y attachments.
- **Full access:** opción **explícita** con confirmación (`fullAccessAcknowledged`). Es más amplio de lo necesario; úsalo solo si entiendes el riesgo.
- Linky **no** puede inspeccionar de forma fiable los scopes ni el expiry a partir del string del PAT; debes informar fechas y elección de scope.
