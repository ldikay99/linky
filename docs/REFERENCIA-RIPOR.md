# Referencia Ripor (UI pública)

**URL oficial:** https://ripor.co/u/horas

## Principios

- Solo automatización de **UI** (fill/click en formularios públicos).
- Prohibido documentar o llamar endpoints internos, inspeccionar red, o reutilizar cookies/tokens de capturas/curls.
- Perfil de navegador: `~/.linky/browser-profiles/ripor` (fuera del repo).
- Gmail/Calendar: fuera de alcance por ahora.

## Dedicación

| Día | Horas exactas | Ventana (informativa) |
|-----|---------------|------------------------|
| Lun–Jue | 8.5 | 08:30–18:00 + pausa comida |
| Viernes | 8 | 08:00–17:00 + pausa comida |

Fecha = calendario **local del dispositivo**. El campo UI es dedicación **numérica**.

## Proyecto área vs Azure

El proyecto que pide Ripor es el **de área / analítico de la persona**. Los proyectos Azure (uno o varios) sirven para armar descripción y evidencias, no sustituyen la elección UI de área.

## Adapter

Ver `agent/lib/browser/`. Capability flags honestas. Mock ≠ producción.

## Futuro (documental)

Integración opcional Gmail/Calendar para ausencias — **no implementada**.


## Observaciones UI (genéricas)

Ver `agent/lib/ripor/uiObservations.ts`. Resumen:

- Form actividad: combobox proyecto (label ambiguo tipo Insertar), spinbutton horas, textboxes descripción/evidencia, combobox transporte (“Seleccionar medio de transporte”).
- Tarea default observada: **Tarea Personalizada**. Transporte ejemplo observado: **🏠 Trabajo Remoto**.
- Wizard: Continuar / Cancelar / Volver / close. Lista: editar (lápiz), eliminar (X), crear (Registrar).
- **Re-snapshot** roles/labels en cada sesión; no refs estáticos.
- Headed auth observada; headless cross-restart **no** validado; adapter producción **no** verificado; ciclo manual IA create/update/delete/reopen verificado; adapter automático de mutaciones no implementado.
- Prohibido versionar reportes reales / IDs / texto privado del usuario.

## Cobertura (fail-closed)

- Create/update exigen `coverageProof` (sustained ≥ draft.hours, source azure_confirmed) **o** under-hours con `dateYmd` vinculado + cantidad.
- Flag `activitiesCoverFullDay` solo no basta.
- Under **no** habilita fin de semana.
- NaN en hours de existentes → bloqueo (no se trata como 0).


## Recorrido genérico confirmado por prueba manual IA (no adapter automático)

Registrar → Registro de Actividades → proyecto dropdown → marcar checkbox **Tarea Personalizada**
(revela horas) → descripción/evidencia → transporte con filtro texto. **Un Continuar guarda
DIRECTAMENTE**; no hay wizard posterior. Editar también guarda al primer Continuar.

Eliminar: X de la fila → **¿Estás seguro que deseas eliminar este registro?** → **Continuar**
confirma borrado. Gate/aprobación específica ANTES. Verificar ausencia antes de recreación
separadamente autorizada. Después de crear, comprobar único reporte y reabrir lápiz para
comparar todos los campos.

Refs Playwright iniciales fallaron; GUI funcionó. Re-snapshot scoped a fila visible; esperar
estabilización y fin de escritura, comprobar URL completa. Solo SINGLE URL de evidencia
verificada. Headless cross-restart no probado. Ver detalles en BROWSER-MCP.md.
