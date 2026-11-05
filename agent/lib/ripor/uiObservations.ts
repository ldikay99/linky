/**
 * Observaciones UI genéricas (roles/labels). Re-snapshot en cada sesión:
 * no hardcodear refs estáticos; preferir getByRole + label/containing text.
 *
 * Auth headed confirmada en observación parent; headless cross-restart NO validado.
 * Ciclo manual IA edit/delete/create/reopen observado por parent. Adapter mutaciones sigue pendiente.
 */

export const RIPOR_UI_OBSERVATIONS = {
  publicUrl: "https://ripor.co/u/horas",
  session: {
    headedAuthObserved: true,
    headlessReuseValidated: false,
    productionAdapterVerified: false,
    postSubmitConfirmationsKnown: true,
    editContinueDirectSaveObserved: true,
    manualCreateDeleteObserved: true,
    automaticSelectorsStable: false,
  },
  /** Formulario Editar/Registrar Actividad — roles genéricos */
  form: {
    projectCombobox: {
      role: "combobox",
      labelHints: ["Insertar", "proyecto", "Ingresa el proyecto"],
      note: "Label ambiguo Insertar; #project-input observado. Re-snapshot contexto; no usar ref estático/selector duplicado.",
    },
    hoursSpinbutton: {
      role: "spinbutton",
      labelHints: ["Dedicación", "horas"],
      note: "Campo numérico de dedicación; no inventar timestamps.",
    },
    descriptionTextbox: {
      role: "textbox",
      labelHints: ["Inserte", "descripción", "actividades"],
    },
    evidenceTextbox: {
      role: "textbox",
      labelHints: ["Insertar", "evidencia", "enlace"],
    },
    transportCombobox: {
      role: "combobox",
      labelHints: ["Seleccionar medio de transporte", "medio de transporte"],
    },
    taskDefaultLabelObserved: "Tarea Personalizada",
    transportOptionObservedExample: "🏠 Trabajo Remoto",
    note: "Otras opciones de transporte: re-listar desde UI; no hardcodear no verificadas como verificadas.",
  },
  wizardButtons: {
    continue: "Continuar",
    warning: "EDITAR: Continuar GUARDA DIRECTAMENTE. Gate de aprobación ANTES del click; no esperar otra confirmación ni toast.",
    cancel: "Cancelar",
    back: "Volver",
    close: "close",
  },
  createObservation: {
    modalHeading: "Registro de Actividades",
    initialFields: ["proyecto/centro de costos", "tareas", "descripción", "evidencia"],
    initialButtons: ["Cancelar", "Continuar"],
    hoursTransportInitiallyVisible: false,
    manualCreateSaveObserved: true,
    hoursAppearAfterTaskCheckbox: "Tarea Personalizada",
    transportFilterTextObserved: true,
    continueSavesDirectly: true,
    evidenceMultipleUrlsVerified: false,
  },
  deleteObservation: {
    confirmationText: "¿Estás seguro que deseas eliminar este registro?",
    confirmButton: "Continuar",
    approvalBeforeConfirmationClick: true,
    absenceMustBeVerifiedBeforeAuthorizedRecreation: true,
  },
  reconciliation: [
    "Después de guardar: verificar un único reporte del día y reabrir lápiz; comparar TODOS los campos.",
    "Esperar estabilización después de cada acción GUI; no continuar mientras se está escribiendo.",
    "Verificar URL de evidencia completa tras input; solo una URL fue validada en UI.",
    "Refs Playwright iniciales fallaron; GUI funcionó. No proclamar selectores automáticos estables.",
  ],
  listActions: {
    editAffordance: "lápiz / editar",
    deleteAffordance: "X / eliminar",
    createAffordance: "Registrar",
  },
  guidance: [
    "Antes de cada apply real: re-snapshot roles/labels; no confiar en selectores estáticos de este archivo.",
    "No usar APIs internas ni curls con cookies.",
    "Datos de reportes reales del usuario: fuera del repo / privados; no copiar a skills ni zip.",
  ],
} as const;
