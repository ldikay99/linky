# Referencia Ripor

**URL oficial:** https://ripor.co/u/horas

## Modos

| Modo | Cuándo | Navegador |
|------|--------|-----------|
| **HTTP** (por defecto) | Registrar, editar, borrar, listar | Solo `ripor login` |
| UI guiada (`ripor check/gate`, `docs/BROWSER-MCP.md`) | Alternativa manual | Sí |
| `--mock` | Pruebas offline | No |

## Peticiones (las mismas que hace la web, SvelteKit)

| Acción | Petición | Campos clave |
|--------|----------|--------------|
| Leer día | `GET /u/horas/getReport?date=YYYY-MM-DD` | — |
| Catálogo/página | `GET /u/horas/__data.json` (formato devalue) | proyectos, tareas, `reports` del mes, `totalhoursPerUser` |
| Crear | `POST /u/horas?/create` (`x-sveltekit-action: true`) | `notes`, `date`, `project_id`, `code`, `hours`, `analytic_account_id`, `reports=[]`, `currentMonth`, `totalhours`, `report_task_id`, `evidencia`, `medio_transporte` |
| Editar | `POST /u/horas?/update` | `id`, `date`, `hours`, `code`, `notes`, `report` (objeto original), `reportDate`, `reports`, `report_task_id`, `evidencia`, `medio_transporte`, … |
| Borrar | `POST /u/horas?/delete` | `id`, `personal_id` (user_id del reporte) |

Respuesta de acciones: `{ type: "success" | "failure" | "redirect" | "error", data }`. Redirect a login / 3xx / HTML = sesión vencida.

`project_id`, `analytic_account_id` y `code` son **distintos** entre sí; se obtienen de un reporte real
(`ripor catalog --from-date`) o del catálogo de la página. Nunca de ejemplos.

## Sesión

- `ripor login`: Chrome/Edge instalado, contexto efímero (sin perfil en disco). Al detectar la sesión, las cookies de auth van al keyring y se cierra.
- `ripor login --paste`: pegar (oculto) el valor del header `cookie` de una petición a ripor.co.
- El servidor refresca tokens con `Set-Cookie`; Linky los guarda de nuevo en el keyring.
- `ripor session --check` valida; `ripor logout` borra del almacén local.
- **Nunca** copiar cookies/curls a repo, fixtures, issues, chat o logs.

## Dedicación

| Día | Horas exactas | Ventana (informativa) |
|-----|---------------|------------------------|
| Lun–Jue | 8.5 | 08:30–18:00 + pausa comida |
| Viernes | 8 | 08:00–17:00 + pausa comida |

Fecha = calendario **local del dispositivo**; fechas futuras bloqueadas; fin de semana bloqueado.
Máximo incluye la suma de todos los reportes del día. Menos horas solo con petición explícita fecha + cantidad.

## Transporte

Valor de formulario verificado: `trabajo_remoto` (🏠 Trabajo Remoto). Los demás (`vehiculo_particular`,
`moto_particular`, `transporte_publico`, `carro_compartido`, `bicicleta`, `patineta_electrica`,
`apps_movilidad`) son **supuestos** y quedan bloqueados hasta verlos en un reporte real:
registra uno en la web con ese medio y ejecuta `ripor catalog --from-date <fecha>` + `ripor setup`.

## Seguridad / idempotencia

- Preview con `snapshotHash`; apply exige `--approve --by --snapshot`; delete además `--delete-confirmed`.
- Journal `pending` antes del POST. Error de red durante el POST o verificación que no cuadra → `unknown` → bloquea hasta `ripor reconcile`.
- Sesión vencida antes de ejecutar → fallo definitivo (no deja el journal abierto).
