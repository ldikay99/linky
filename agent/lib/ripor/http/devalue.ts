/**
 * Decodificador mínimo del formato "devalue" que usa SvelteKit en __data.json
 * y en las respuestas de form actions (`data` es un string devalue).
 * Solo lectura; tipos desconocidos se devuelven como null (no se ejecuta nada).
 */

const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

function special(index: number): unknown {
  if (index === UNDEFINED) return undefined;
  if (index === NAN) return Number.NaN;
  if (index === POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (index === NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;
  if (index === NEGATIVE_ZERO) return -0;
  throw new Error(`devalue: índice inválido ${index}`);
}

export function unflatten(parsed: unknown): unknown {
  if (typeof parsed === "number") return special(parsed);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("devalue: se esperaba un arreglo no vacío");
  const values = parsed as unknown[];
  const hydrated = new Map<number, unknown>();

  function hydrate(index: number): unknown {
    if (index < 0) return special(index);
    if (hydrated.has(index)) return hydrated.get(index);
    const value = values[index];

    if (!value || typeof value !== "object") {
      hydrated.set(index, value);
      return value;
    }

    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        const [type, ...rest] = value as [string, ...unknown[]];
        let out: unknown;
        switch (type) {
          case "Date":
            out = new Date(String(rest[0]));
            break;
          case "Set": {
            const set = new Set<unknown>();
            hydrated.set(index, set);
            for (const i of rest) set.add(hydrate(i as number));
            return set;
          }
          case "Map": {
            const map = new Map<unknown, unknown>();
            hydrated.set(index, map);
            for (let i = 0; i < rest.length; i += 2) map.set(hydrate(rest[i] as number), hydrate(rest[i + 1] as number));
            return map;
          }
          case "BigInt":
            out = BigInt(String(rest[0]));
            break;
          case "Object":
            out = rest[0];
            break;
          case "null": {
            const obj: Record<string, unknown> = Object.create(null);
            hydrated.set(index, obj);
            for (let i = 0; i < rest.length; i += 2) obj[String(rest[i])] = hydrate(rest[i + 1] as number);
            return obj;
          }
          default:
            out = null;
        }
        hydrated.set(index, out);
        return out;
      }
      const arr: unknown[] = new Array(value.length);
      hydrated.set(index, arr);
      for (let i = 0; i < value.length; i++) {
        const n = value[i] as number;
        if (n === HOLE) continue;
        arr[i] = hydrate(n);
      }
      return arr;
    }

    const obj: Record<string, unknown> = {};
    hydrated.set(index, obj);
    for (const [k, n] of Object.entries(value as Record<string, number>)) obj[k] = hydrate(n);
    return obj;
  }

  return hydrate(0);
}

/** `devalue.stringify` (texto) → valor. */
export function parseDevalue(text: string): unknown {
  return unflatten(JSON.parse(text));
}

/**
 * __data.json de SvelteKit: { type: "data", nodes: [{ type: "data", data: [...] } | null | { type: "skip" }] }.
 * Devuelve los datos de cada nodo (layout(s) + página) ya decodificados.
 */
export function decodeSvelteKitData(text: string): unknown[] {
  // Puede venir en streaming (líneas extra para promesas): solo la primera línea es el payload base.
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  const parsed = JSON.parse(first) as { type?: string; nodes?: Array<{ type?: string; data?: unknown } | null> };
  if (parsed.type === "redirect") throw new Error("SVELTEKIT_REDIRECT");
  if (parsed.type !== "data" || !Array.isArray(parsed.nodes)) throw new Error("__data.json con formato inesperado");
  return parsed.nodes.map((n) => (n && n.type === "data" && Array.isArray(n.data) ? unflatten(n.data) : null));
}
