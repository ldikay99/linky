/**
 * Iconos de Linky dibujados a mano: cuadrícula de 24, trazo 1.7, extremos y uniones redondeados.
 * Genéricos a propósito (sin logos de marcas de terceros).
 */
import type { SVGProps } from "react";

const P = {
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M12 19V5.5M6.5 11 12 5.5 17.5 11" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none" />,
  paperclip: <path d="M20.2 11.6 12.4 19.4a5 5 0 0 1-7.1-7.1l7.6-7.6a3.4 3.4 0 0 1 4.8 4.8l-7.5 7.5a1.8 1.8 0 0 1-2.6-2.6l7-7" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  chat: <path d="M7.5 18.5 4 20.5v-4.3A7.5 7.5 0 0 1 3.5 12c0-4.1 3.8-7.5 8.5-7.5s8.5 3.4 8.5 7.5-3.8 7.5-8.5 7.5c-1.6 0-3.1-.4-4.5-1Z" />,
  plug: (
    <>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3Z" />
      <path d="M12 16v4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
      <path d="M17 8.5 20.5 12 17 15.5M20.5 12H10" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  alert: (
    <>
      <path d="M10.3 4.6 3.3 17a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12.4a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 16.8v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M10 4.5h4M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  pencil: <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.2L16 4.8a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5l-4.2 1Z" />,
  download: (
    <>
      <path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 16.5v1a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5M10.5 7.8v5.4M7.8 10.5h5.4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5M7.8 10.5h5.4" />
    </>
  ),
  rotate: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  fit: <path d="M4.5 9V6.5a2 2 0 0 1 2-2H9M15 4.5h2.5a2 2 0 0 1 2 2V9M19.5 15v2.5a2 2 0 0 1-2 2H15M9 19.5H6.5a2 2 0 0 1-2-2V15" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  fileText: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5M9 13h6M9 16.5h4" />
    </>
  ),
  filePdf: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M8.5 16.5c1.6-.4 4.8-2.8 4.8-4.6 0-1.2-1.4-1.2-1.4 0 0 2 2.6 4.4 3.6 4.6" />
    </>
  ),
  sheet: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
      <path d="M4 9.5h16M4 14.5h16M10 4.5v15" />
    </>
  ),
  slides: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11" rx="2.5" />
      <path d="M12 15.5v4M8.5 19.5h7" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="9" cy="9.5" r="1.7" />
      <path d="m4 17 4.6-4.4a1.6 1.6 0 0 1 2.2 0L16 17.5M14 15.4l1.6-1.5a1.6 1.6 0 0 1 2.2 0l2.2 2" />
    </>
  ),
  code: <path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.2 5.5l-2.4 13" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
      <path d="m4.5 7.5 6.3 4.6a2 2 0 0 0 2.4 0l6.3-4.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
      <circle cx="8.5" cy="14.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.5" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  boards: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M7.5 8.5v7M12 8.5v4M16.5 8.5v5.5" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 19c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5" />
    </>
  ),
  message: (
    <>
      <path d="M5.5 4.5h13a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H10l-4.5 3v-3a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" />
      <path d="M8 9.5h8M8 13h5" />
    </>
  ),
  branch: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6M17 10.2c0 3.8-4 3.8-8.2 6.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 11a7.5 7.5 0 0 0-13.4-3.9M4.5 13a7.5 7.5 0 0 0 13.4 3.9" />
      <path d="M5.5 3.8v3.7h3.7M18.5 20.2v-3.7h-3.7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10 5.8A9 9 0 0 1 12 5.5c5.8 0 9.2 6.5 9.2 6.5a16 16 0 0 1-2.6 3.4M6.6 7.2C4.2 8.9 2.8 12 2.8 12s3.4 6.5 9.2 6.5a8.8 8.8 0 0 0 4.4-1.2" />
      <path d="M4 4l16 16M10 10a2.8 2.8 0 0 0 4 4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6.2v5.3c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.2L12 3.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.6" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 5.5v-.2a1.8 1.8 0 0 0-1.8-1.8H6.3a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 0 1.8 1.8h.2" />
    </>
  ),
  arrowDown: <path d="M12 5v13.5M6.5 13 12 18.5 17.5 13" />,
  arrowRight: <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />,
  external: <path d="M13.5 4.5h6v6M19.5 4.5 11 13M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" />,
  wave: <path d="M4 12h1.5M8 8.5v7M12 5.5v13M16 8.5v7M20 11v2" />,
  memory: (
    <>
      <path d="M9 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 4.5 13a3 3 0 0 0 1.8 2.8A3.2 3.2 0 0 0 9.5 19.5c1 0 1.9-.4 2.5-1.1.6.7 1.5 1.1 2.5 1.1a3.2 3.2 0 0 0 3.2-3.7A3 3 0 0 0 19.5 13a3 3 0 0 0-1.5-5.3v-.2a3 3 0 0 0-5.3-1.9H11.3A3 3 0 0 0 9 4.5Z" />
      <path d="M12 6v12.4M9 10.5c1.2 0 2 .8 3 .8s1.8-.8 3-.8" />
    </>
  ),
  steps: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M6 8v8M11 6h9M11 18h9M11 12h6" />
    </>
  ),
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, strokeWidth = 1.7, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {P[name]}
    </svg>
  );
}

export function kindIcon(kind: string): IconName {
  switch (kind) {
    case "image":
      return "image";
    case "pdf":
      return "filePdf";
    case "word":
      return "fileText";
    case "sheet":
      return "sheet";
    case "slides":
      return "slides";
    case "text":
      return "code";
    default:
      return "file";
  }
}
