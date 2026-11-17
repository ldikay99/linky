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

/**
 * Linky, la mascota de LinkTIC, redibujada en la paleta oscura de la interfaz (grises; el pico claro es el acento).
 * Guiña cada pocos segundos y se inclina al pasar el puntero; sin movimiento si la persona lo prefiere.
 */
export function Mascot({ size = 96, label = "Linky, la mascota de LinkTIC" }: { size?: number; label?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className="mascot" role="img" aria-label={label}>
      <defs>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#26262c" />
          <stop offset="0.38" stopColor="#4b4b55" />
          <stop offset="1" stopColor="#646470" />
        </linearGradient>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f1f4" />
          <stop offset="1" stopColor="#c9c9d0" />
        </linearGradient>
        <radialGradient id={`s${id}`} cx="0.35" cy="0.18" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`c${id}`}>
          <circle cx="60" cy="60" r="56" />
        </clipPath>
      </defs>
      <circle cx="60" cy="60" r="56" fill="#1b1b1f" />
      <circle cx="60" cy="60" r="55.4" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1.2" />
      <g clipPath={`url(#c${id})`}>
        <g className="mascot__bird">
          <path d="M97 74 C110 84 116 102 112 122 L90 122 C93 104 93 88 97 74 Z" fill="#9a9aa4" />
          <path d="M97 74 C104 80 108 88 110 98 C104 92 99 90 95 90 Z" fill="#b7b7c0" />
          <path d="M20 122 V64 C20 34 38 16 60 16 C82 16 100 34 100 64 V122 Z" fill={`url(#h${id})`} />
          <path d="M20 122 V64 C20 34 38 16 60 16 C82 16 100 34 100 64 V122 Z" fill={`url(#s${id})`} />
          <circle cx="39" cy="55" r="13" fill="#6a6a76" />
          <circle cx="81" cy="55" r="13" fill="#6a6a76" />
          <circle cx="39" cy="54" r="6.6" fill="#0b0b0d" />
          <circle cx="41.6" cy="51.6" r="2.1" fill="#ffffff" />
          <g className="mascot__eye-open">
            <circle cx="81" cy="54" r="6.6" fill="#0b0b0d" />
            <circle cx="83.6" cy="51.6" r="2.1" fill="#ffffff" />
          </g>
          <path className="mascot__eye-wink" d="M74.5 55.5 L87 51 M74.5 55.5 L87 59" stroke="#0b0b0d" strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M48 46 L66 40 C71 46 73 56 70 66 L60 82 L50 66 C47 60 46 52 48 46 Z" fill={`url(#b${id})`} />
          <path d="M66 40 C71 46 73 56 70 66 L60 82 L61 54 Z" fill="#a7a7b0" />
          <path d="M50 66 L60 82 L55 70 Z" fill="#7e7e88" />
        </g>
      </g>
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
