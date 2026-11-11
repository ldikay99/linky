/**
 * Identidad de Linky.
 * - Isotipo: el trazo en "L" (la jornada que avanza) que remata en un anillo (el enlace que la registra).
 * - Logotipo: la palabra "Linky" con ajuste óptico propio.
 * - Imagotipo: isotipo + logotipo.
 */
import { useId } from "react";

export function Isotype({ size = 32, animated = false, tile = true }: { size?: number; animated?: boolean; tile?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={animated ? "iso iso--animated" : "iso"} role="img" aria-label="Linky">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3b42" />
          <stop offset="1" stopColor="#131315" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#bdbdc4" />
        </linearGradient>
        <radialGradient id={`g${id}`} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {tile && (
        <>
          <rect width="64" height="64" rx="17" fill={`url(#t${id})`} />
          <rect width="64" height="64" rx="17" fill={`url(#g${id})`} />
          <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="16.25" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1.5" />
        </>
      )}
      <path className="iso__stem" d="M22 16v24a8 8 0 0 0 8 8h12" fill="none" stroke={tile ? `url(#s${id})` : "currentColor"} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <circle className="iso__ring" cx="43" cy="21" r="6" fill="none" stroke={tile ? `url(#s${id})` : "currentColor"} strokeWidth="5" pathLength={1} />
    </svg>
  );
}

export function Logotype({ size = 20 }: { size?: number }) {
  return (
    <span className="logotype" style={{ fontSize: size }} aria-label="Linky">
      Linky
    </span>
  );
}

export function Imagotype({ size = 28 }: { size?: number }) {
  return (
    <span className="imagotype">
      <Isotype size={size} />
      <Logotype size={Math.round(size * 0.68)} />
    </span>
  );
}
