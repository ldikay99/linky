/**
 * Mensajes de error de Linky: los mismos en el servidor y en la interfaz. Cortos, claros y sin detalles internos
 * (nada de rutas, trazas, tokens ni nombres de tablas).
 */
export const MSG = {
  // generales
  network: "Sin conexión con Linky. Revisa que esté abierto.",
  internal: "Algo falló de nuestro lado. Intenta de nuevo.",
  invalid: "Datos inválidos.",
  notFound: "No encontrado.",
  tooMany: "Demasiadas solicitudes. Espera un momento.",
  tooLarge: "La solicitud es demasiado grande.",
  host: "Dirección no permitida.",
  origin: "Origen no permitido.",
  csrf: "La sesión cambió. Recarga la página.",
  session: "Sesión vencida. Recarga la página.",
  multiLogin: "El inicio de sesión con cuenta llega pronto.",
  timeout: "Tardó demasiado. Intenta de nuevo.",

  // chat
  emptyMessage: "Escribe un mensaje o adjunta un archivo.",
  messageTooLong: "El mensaje supera 32.000 caracteres.",
  tooManyAttachments: "Máximo 12 adjuntos por mensaje.",
  busyConversation: "Esta conversación aún está respondiendo.",
  conversationNotFound: "Conversación no encontrada.",
  approvalNotFound: "Aprobación no encontrada.",
  approvalDone: "Esta aprobación ya se resolvió.",
  titleEmpty: "El título no puede quedar vacío.",
  titleTooLong: "El título admite hasta 120 caracteres.",

  aiAuth: "El proveedor de IA rechazó la clave configurada.",
  aiRate: "El proveedor de IA está saturado. Intenta en un momento.",
  aiFailed: "El asistente no pudo responder. Intenta de nuevo.",

  // archivos
  fileMissing: "No llegó ningún archivo.",
  fileType: "Formato no permitido. Usa imágenes, PDF, Word, Excel, PowerPoint o texto.",
  fileVideo: "Videos y audio no se adjuntan.",
  fileTooBig: (mb: number) => `El archivo supera ${mb} MB.`,
  fileNotFound: "Archivo no encontrado.",
  filePreview: "Este formato no tiene vista previa. Puedes descargarlo.",

  // dictado
  sttOff: "El dictado del servidor no está activo.",
  audioInvalid: "Audio no válido.",
  micDenied: "Permite el micrófono para dictar.",
  micUnavailable: "No se pudo usar el micrófono.",
  sttUnavailable: "El dictado no está disponible ahora.",

  // conectores
  orgUrl: "Usa https://dev.azure.com/tu-organizacion.",
  pat: "Token inválido: pégalo completo, sin espacios.",
  noInteractiveLogin: "Este servidor no puede abrir el inicio de sesión de Google o Ripor.",
  repoRoot: "Indica la carpeta de tus repositorios.",

  // perfil
  required: "Campo obligatorio.",
  hhmm: "Usa el formato HH:MM.",
  range: "La salida debe ser después de la entrada.",
  tooLong: (n: number) => `Máximo ${n} caracteres.`,
} as const;
