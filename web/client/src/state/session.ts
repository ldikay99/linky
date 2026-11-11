import { createContext, useContext } from "react";
import type { SessionInfo } from "../../../shared/protocol";

export const SessionContext = createContext<SessionInfo | null>(null);
export const useSession = () => useContext(SessionContext);
