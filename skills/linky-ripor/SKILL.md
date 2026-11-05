---
name: linky-ripor
description: Guía agnóstica de IA para registrar horas diarias en Ripor (UI pública) con núcleo determinista Linky + puente Playwright autorizado. Instalación local; no cloud ni app chat.
---

# Linky — Ripor horas (agnóstico de proveedor)

**Autor:** Jonathan Contreras

URL pública oficial: **https://ripor.co/u/horas**

Núcleo: `npm run linky -- ripor …` (local). No depende de Grok/ChatGPT/Claude/eve/AI Gateway.

## Alcance y límites

- **SOLO UI Ripor** vía formularios públicos. Prohibido: APIs internas/undocumented, network inspection, `run_code_unsafe`, navegador desde Shell, extraer/guardar cookies/tokens/passwords.
- Perfil de navegador persistente **fuera del repo** (`~/.linky/browser-profiles/ripor`). No documentar ni reutilizar curls con cookies.
- Headed login **solo** si falta sesión; headless después **solo si el runtime lo comprueba**. No afirmar conector operativo sin verificación.
- Ciclo manual IA UI crear/editar/borrar/reabrir verificado por host; selectores automáticos estables NO validados. Mocks siguen marcados y nunca prueban capacidad live.
- Gmail/Calendar: **fuera de alcance** (futura integración solo documental).
- Instalación: cualquier IA en la máquina del usuario; **no** servicio cloud ni app chat.

## Arquitectura

1. **Skill agnóstica** (este archivo) — instrucciones para cualquier asistente.
2. **Núcleo determinista** — `agent/lib/ripor/*` (políticas, preview hash, journal fail-closed).
3. **Puente** — `agent/lib/browser/*` adapter + capability flags. Implementación real = herramientas Playwright MCP del host. Stub `unimplemented` / `mock` no es producción.

## Setup (una vez)

Distinguir SIEMPRE:

| Campo | Qué es |
|-------|--------|
| **Proyecto de área Ripor** | Mandatory. Elegir de **opciones reales UI**. Nunca IDs/default del ejemplo. |
| **Proyectos Azure** | Uno o varios; solo hints para descripción/evidencia. **No** se envían como proyecto Ripor. |

También:

1. **Tarea**: por defecto **"Tarea Personalizada"** (confirmar label UI). Override solo si el usuario lo pide explícitamente.
2. **Medio de transporte**: setup una vez desde opciones observadas. Override diario **no** reescribe el default.
3. Horario laboral configurado: lun–jue **08:30–18:00**, viernes **08:00–17:00**, pausa comida explícita (informativa).
4. Dedicación numérica: **exacto 8.5 h** lun–jue y **8 h** viernes (fecha LOCAL del dispositivo). Nunca exceder el máximo **incluyendo la suma de todos los reportes existentes ese día**.

Usuario cita opciones de transporte (remoto, particular/moto, público, compartido, bici, patineta, apps). **No hardcodear como verificadas** hasta observar UI; mocks deben marcarse no verificados.

## Campos del formulario (UI)

- Ingresa el proyecto *
- Selecciona las tareas * (default Tarea Personalizada)
- Dedicación de Actividad * → **número de horas** (no inventar timestamps UI)
- Breve descripción * → resumen de tareas/actividades Azure **confirmadas** (sin fabricar; sin plan futuro como hecho)
- Evidencia * → uno o varios links válidos **sin credenciales** embebidas; validar URL
- Medio de transporte *

## Cobertura (fail-closed)

Create/update exigen `coverageProof` (`sustainedActivityHours` ≥ horas del draft, `coversDraftDedication: true`, `source: "azure_confirmed"`) **o** under-hours con `dateYmd` vinculado a la mutación. El flag `activitiesCoverFullDay` solo **no basta**. Under **no** habilita fin de semana. NaN en existentes → bloqueo.

## Políticas (fail-closed)

- Menos de la jornada **solo** con petición explícita limitada a **fecha + cantidad**; no permanente.
- Días sin trabajo / festivos / ausencias: **no crear inventando**.
- Si actividades sustentadas no suman la jornada: **bloquear** y preguntar faltantes/excepción. No inflar ni rellenar ficción.
- Preview con **snapshotHash**; aprobación específica por create / update / delete.
- Update: preview **before/after**.
- Delete: solo petición explícita **fecha + id** + **confirmación separada**. Nunca workaround delete+create sin permiso.
- Idempotencia / reconcile: UI incierta → fail-closed; **no** repetir POST/click guardar.
- Sumar existentes para evitar duplicados; **revalidar políticas en apply**.

## CLI (seguro, local)

```bash
npm run linky -- ripor setup --answers examples/synthetic/ripor-setup.json --mock --data-dir "$HOME/.linky-demo"
npm run linky -- ripor preview --draft examples/synthetic/ripor-draft.json --mock --data-dir "$HOME/.linky-demo"
npm run linky -- ripor apply --preview <file> --approve --by <quien> --snapshot <hash> --mock --data-dir "$HOME/.linky-demo"
npm run linky -- ripor delete-preview --date YYYY-MM-DD --id <id> --mock --data-dir "$HOME/.linky-demo"
npm run linky -- ripor status --data-dir "$HOME/.linky-demo"
```

`--mock` usa adapter sintético. Apply real requiere adapter Playwright inyectado por el host (no disponible en todos los procesos).

## Qué NO hacer

- No leer/copiar/guardar curls con cookies o tokens del usuario.
- No reportar horas reales a Ripor desde este entorno de build sin revisión final / aprobación del usuario.
- No push/publicar hasta revisión final.
- No presentar headless/MCP como “funcionando” si no está comprobado.

## Integración pendiente (UI real)

- Observación read-only de labels/selectores reales (parent).
- Mapear `formValue` verificados de proyecto/tarea/transporte.
- Inyectar adapter Playwright MCP con capability flags verdaderos.
- Login headed una vez; reutilizar perfil sin extraer secretos.


## UI observada (genérica)

Ver `agent/lib/ripor/uiObservations.ts`. Tarea default: **Tarea Personalizada**. Transporte ejemplo: **🏠 Trabajo Remoto**. Re-snapshot roles/labels cada sesión. Headless cross-restart no validado; adapter producción pendiente.


## Instalación portable y operación UI guiada

Leer **`docs/BROWSER-MCP.md`** antes de instalar/usar el navegador. `browser setup/status`
genera configuración stdio fuera del repo; no instala nada, no conecta el cliente actual.
Cualquier IA con MCP/local tools puede usarla; no cualquier chatbot sin herramientas.

Azure con PAT válido usa REST WIT oficial; NO exigir browser Azure para leer tareas.
Ripor es solo UI sesión local. No export storage ni credenciales. Nunca 1-login-eterno.

Tools autorizados del adaptador: navigate URL oficial, snapshot, click solo combobox único
para observar opciones. Formulario ambiguo → inspección UI guiada, no IDs inventados.
Live report parser y mutations siguen rechazados explícitamente; apply --mock NO es live.

Para UI observada real: `ripor check --input <json-privado>` y revalidar con
`ripor gate --input <json> --approve --by <usuario> --snapshot <hash>` antes de cada submit.
El input debe contener todos existentes/opciones realmente observados; no reemplazar con mocks.
Gate no hace click y no es comprobación de éxito. Obtener aprobación real, no inventar `--by`.

**EDITAR Y CREAR: Continuar GUARDA DIRECTAMENTE. Aprobación/gate ANTES del click.**
No hay confirmación extra ni toast: reabrir y reconciliar; incertidumbre = parar, no repetir.
Crear: marcar Tarea Personalizada revela horas y aparece transporte (combobox filtro texto). Un Continuar guarda directamente, sin wizard posterior. Eliminar: X → ¿Estás seguro que deseas eliminar este registro? → Continuar confirma; gate/aprobación antes.
Evidencia singleline: múltiples URLs aceptadas por núcleo NO implica UI multi-URL verificada.


## Reconciliación obligatoria del ciclo manual IA

Tras eliminar, verificar ausencia antes de recreación separadamente aprobada. Tras crear,
verificar único reporte y reabrir lápiz; comparar TODOS los campos. No repetir guardar
si resultado incierto. Iconos lápiz/X sin nombre: re-snapshot scoped a fila visible, sin IDs
hardcodeados. GUI puede tardar segundos; esperar estabilización y fin de escritura,
comprobar URL completa. SINGLE URL verificada; multiURL no confirmada.

El ciclo manual IA con herramientas está verificado; **adapter automático de mutaciones
NO implementado/soportado**, selectores Playwright no declarados estables, headless
cross-restart no probado. No convertir demo mock en afirmación de producción.
