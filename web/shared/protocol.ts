/** Contrato entre el cliente y el servidor web de Linky (API REST + eventos del chat por SSE). */

export type FileKind = "image" | "pdf" | "word" | "sheet" | "slides" | "text";

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  kind: FileKind;
  size: number;
};

export type ToolPart = {
  type: "tool";
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  output?: string;
  ms?: number;
};

export type ApprovalPart = {
  type: "approval";
  id: string;
  toolName: string;
  title: string;
  summary: string[];
  status: "pending" | "approved" | "rejected" | "failed";
  result?: string;
};

export type NoticePart = {
  type: "notice";
  tone: "info" | "warn" | "error";
  text: string;
  action?: "open-connectors" | "open-onboarding";
};

export type TextPart = { type: "text"; text: string };

export type UiPart = TextPart | ToolPart | ApprovalPart | NoticePart;

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  text?: string;
  attachments?: Attachment[];
  parts?: UiPart[];
};

export type ConversationSummary = { id: string; title: string; updatedAt: number };

export type Conversation = ConversationSummary & { messages: UiMessage[] };

export type StreamEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "message"; message: UiMessage }
  | { type: "text"; delta: string }
  | { type: "part"; part: ToolPart | ApprovalPart | NoticePart }
  | { type: "part-update"; id: string; patch: Partial<ToolPart> | Partial<ApprovalPart> }
  | { type: "error"; message: string }
  | { type: "done" };

export type AiStatus = { configured: boolean; provider: string | null; model: string | null };

export type SessionInfo = {
  user: { id: string; name: string; email: string | null; role: "owner" | "admin" | "member" };
  csrf: string;
  ai: AiStatus;
  stt: "server" | "browser";
  onboarded: boolean;
  tenancy: "single" | "multi";
  maxUploadMb: number;
  /** false en servidores sin pantalla: Google y Ripor llegarán por la integración directa de Google Cloud. */
  interactiveLogin: boolean;
  version: string;
};

export type ConnectorId = "azure" | "google" | "ripor" | "chat" | "dev";

export type ConnectorState = "connected" | "attention" | "disconnected" | "optional";

export type Connector = {
  id: ConnectorId;
  name: string;
  description: string;
  state: ConnectorState;
  details: string[];
  fix?: string;
  optional: boolean;
};

export type ConnectorsResponse = { connectors: Connector[]; checkedAt: number; problems: string[] };

export type OnboardingStepId = "azure" | "profile" | "google" | "ripor" | "chat" | "meetings" | "dev" | "review";

export type OnboardingStep = { id: OnboardingStepId; title: string; done: boolean; optional: boolean };

export type MeetingItem = { title: string; status: "confirmed" | "pending" | "ignored" };

export type ProfileForm = {
  organizationUrl: string;
  project: string;
  occupation: string;
  projectContext: string;
  assignedDisplayName: string;
  responsibleTag?: string;
  mondayToThursday: { start: string; end: string };
  friday: { start: string; end: string };
  lunchStart: string;
  lunchEnd: string;
  huCreation: "user_or_ai_with_approval" | "scrum_or_third_party_only";
  taskClose: "same_user" | "scrum_or_third_party" | "ask_each_time";
  huClose: "same_user" | "scrum_or_third_party" | "ask_each_time";
};

export type FilePreview =
  | { kind: "html"; html: string }
  | { kind: "sheet"; sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> }
  | { kind: "text"; text: string; language: string; truncated: boolean }
  | { kind: "unsupported"; reason: string };
