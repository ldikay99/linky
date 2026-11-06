---
name: linky-ripor
description: Guía agnóstica de IA para registrar las horas diarias en Ripor (https://ripor.co/u/horas) vía HTTP con la sesión del propio usuario. Navegador solo para iniciar sesión. Núcleo determinista Linky con preview, aprobación y journal.
---

# Linky — Ripor horas (agnóstico de proveedor)

**Autor:** Jonathan Contreras

URL oficial: **https://ripor.co/u/horas**. Núcleo: `npm run linky -- ripor …` (local; sirve con cualquier IA que pueda ejecutar comandos).

## Cómo funciona

- **HTTP por defecto**: el CLI envía las mismas peticiones que el formulario web, con la sesión del usuario guardada en el keyring. Rápido, sin navegador.
- **Navegador solo para login**: `ripor login` abre Chrome/Edge una vez; al iniciar sesión se cierra solo. Si la sesión vence, el CLI responde `RIPOR_SESSION_EXPIRED` → repetir `ripor login`.
- Alternativa sin navegador: `ripor login --paste` (el usuario pega, oculto, el header `cookie` de ripor.co).
- **Nunca** pidas, leas, copies ni guardes cookies/tokens en el chat, repo, archivos o logs. Si el usuario los pega en el chat, adviértele que cierre sesión en ripor.co para invalidarlos.

## Bienvenida (al iniciar el onboarding)

Cuando entiendas el proyecto y empieces el onboarding con la persona, ejecuta `npm run linky -- welcome`
y muestra su salida **tal cual, dentro de un bloque de código** (logo Linky y créditos a Jonathan Contreras).
Linky no usa API keys: funciona con el asistente de IA que la persona prefiera.

## Setup (una vez)

1. `npm run linky -- ripor login`
2. `npm run linky -- ripor catalog --from-date <YYYY-MM-DD de un reporte que ya exista>` → IDs exactos del proyecto, tarea y transporte. Sin reporte previo: `ripor catalog` (heurístico) y confirmar con el usuario.
3. Preguntar y confirmar con la persona (nunca copiar el proyecto de área, tarea o transporte de otra persona o de ejemplos):
   - **Proyecto de área Ripor** (el del área/contrato de la persona) — distinto de los proyectos Azure.
   - **Tarea**: por defecto "Tarea Personalizada" salvo que el usuario pida otra.
   - **Medio de transporte por defecto** (remoto, vehículo/moto particular, transporte público, carro compartido, bicicleta, patineta eléctrica, apps de movilidad).
4. `npm run linky -- ripor setup --answers ~/.linky/ripor-setup-answers.json --project "<label>" --transporte "<label>"`

Transporte (valores oficiales del formulario): 🚗 Vehículo particular · 🏍️ Moto particular · 🚌 Transporte público · 🚲 Bicicleta · 🛴 Patineta eléctrica · 🚶 Caminata · 🚗 Carro Compartido · 📱 Apps de movilidad (Uber, Picap, etc.) · 🏠 Trabajo Remoto. Usar el label exacto en `--transporte`.

## Registro diario

1. Fecha = **hoy en Colombia** (aunque el equipo esté en otra zona; `LINKY_TZ` la cambia). No reportar fechas
   futuras; fines de semana y festivos bloqueados salvo trabajo extra que la persona pida (ver abajo).
2. `npm run linky -- ripor list` → ver si ya hay reporte hoy (no duplicar; si existe y hay que corregir, usar update).
3. Reunir lo hecho: `npm run linky -- azure activity --date <día>` (organización principal; `--all` si trabaja en varias). Usar el día que el usuario indique (p. ej. "con lo de ayer").
4. Redactar **descripción breve** en pasado que resuma esas tareas: **50 a 500 caracteres** (Ripor exige mínimo 50). Sin inventar ni mezclar planes.
5. **Evidencia**: **un** enlace real que abra; preferir la **HU padre** de las tareas del día (cubre todo), o la Task principal. El formulario valida una sola URL. Sin credenciales en la URL.
6. Horas: **8.5 lun–jue, 8 vie**, sumando todos los reportes del día. Nunca más. Menos solo si el usuario lo pide explícitamente para esa fecha (`--under-hours "motivo" --hours N`).
7. Atajo recomendado: `npm run linky -- ripor suggest --date <día>` propone descripción (desde Azure), evidencia
   (HU padre más frecuente) y horas sustentadas, con avisos si Azure no cubre la jornada (preguntar, no inventar).
   `ripor preview --auto --date <día>` arma el preview con esa sugerencia; lo que pases explícito (`--notes`,
   `--evidence`, `--sustained`) tiene prioridad. Revisa el texto con la persona antes de aprobar.
8. Preview manual:
   ```bash
   npm run linky -- ripor preview --notes "<descripción>" --evidence <url1> --evidence <url2> --sustained <horas sustentadas en Azure>
   # opcionales: --date YYYY-MM-DD --transporte "<label del día>" --task "<label>" --update <reportId>
   ```
8. Mostrar al usuario `mostrarAlUsuario` y pedir aprobación explícita.
9. Aplicar con el hash del preview:
   ```bash
   npm run linky -- ripor apply --preview <out> --approve --by <usuario> --snapshot <hash>
   ```
   `--snapshot` es obligatorio: es el hash del preview que la persona aprobó (si se generó otro preview después,
   no coincide y no se aplica nada).

## Mes completo y festivos

```bash
npm run linky -- ripor month [--month YYYY-MM] [--suggest]
```

- Laborable = lunes a viernes que no es festivo de Colombia (Ley Emiliani, calculados sin red) ni festivo extra
  configurado (`extraHolidays` en el perfil). Sábados, domingos y festivos **no se exigen ni se llenan**; si alguien
  reportó horas ahí aparecen como `extra` y se respetan.
- Linky bloquea crear o editar en festivos y fines de semana. Si la persona **trabajó** ese día y **pide**
  reportarlo: `ripor preview --date <día> --trabajo-extra --hours <las que indicó>` (tope de una jornada completa).
  Nunca proponerlo por iniciativa propia.
- `--suggest` propone el reporte de cada día pendiente desde Azure; para cada uno: `ripor preview --auto --date <día>`.

## Sin fechas en la descripción

La descripción nunca lleva fechas (`04/11`, `2026-11-04`, `4 de noviembre`…): la fecha es el día seleccionado del
reporte. Linky bloquea el preview si encuentra una y las quita de las sugerencias automáticas.

## Corregir / borrar

- Corregir: `ripor preview --update <reportId> …` (muestra antes/después) → aprobación → `ripor apply`.
- Ojo: al **editar**, Ripor guarda la evidencia nueva en `evidence` pero la columna visible `evidencia` conserva la de creación (`ripor list` lo advierte). Para cambiar la evidencia visible: borrar y crear, con aprobación del usuario.
- Borrar: solo si el usuario lo pide con fecha + id: `ripor delete-preview --date <fecha> --id <reportId>` → confirmación separada → `ripor apply … --delete-confirmed`. Nunca borrar+crear como atajo sin permiso.

## Si algo queda incierto

El CLI relee el día tras cada mutación. Si no cuadra o la red falló durante el envío, el journal queda `unknown` y bloquea nuevos envíos:
`npm run linky -- ripor reconcile` → comparar con lo que hay en Ripor → `ripor reconcile --id <journalId> --status ok|failed`. **No repetir el envío a ciegas.**

## Qué NO hacer

- No inventar horas, tareas, evidencias ni IDs.
- No usar el proyecto Azure como proyecto de área Ripor.
- No aplicar sin aprobación del usuario sobre el preview actual.
- No guardar ni mostrar cookies/tokens.

Detalle técnico: `docs/REFERENCIA-RIPOR.md`. UI guiada como alternativa: `docs/BROWSER-MCP.md`.
