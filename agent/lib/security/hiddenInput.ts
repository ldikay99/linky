import { createInterface } from "node:readline";
import { stdin as input, stdout as output, stderr } from "node:process";

/**
 * Lee un secreto sin eco. No registra el valor.
 * En tests/non-TTY, usa process.env.LINKY_HIDDEN_INPUT_FALLBACK solo si se pasa allowEnvFallback.
 */
export async function readHiddenPrompt(
  prompt: string,
  opts?: { allowEnvFallback?: boolean },
): Promise<string> {
  if (!input.isTTY) {
    if (opts?.allowEnvFallback && process.env.LINKY_HIDDEN_INPUT_FALLBACK) {
      const v = process.env.LINKY_HIDDEN_INPUT_FALLBACK;
      delete process.env.LINKY_HIDDEN_INPUT_FALLBACK;
      return v;
    }
    throw new Error(
      "No hay TTY para entrada oculta. Use keyring ya configurado, LINKY_AZURE_PAT, o sesión con --pat-session en entorno controlado.",
    );
  }

  stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    const onData = (chunk: Buffer | string) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (s === "\u0003") {
        cleanup();
        reject(new Error("Cancelado"));
        return;
      }
      if (s === "\n" || s === "\r" || s.endsWith("\n") || s.endsWith("\r")) {
        const value = buffer.join("").replace(/[\r\n]+$/, "");
        cleanup();
        stderr.write("\n");
        resolve(value);
      } else if (s === "\u007f" || s === "\b") {
        buffer.pop();
      } else {
        buffer.push(s);
      }
    };
    const buffer: string[] = [];
    const cleanup = () => {
      input.off("data", onData);
      try {
        input.setRawMode?.(wasRaw ?? false);
      } catch {
        /* ignore */
      }
      input.pause();
    };
    try {
      input.setRawMode?.(true);
    } catch {
      /* algunos entornos no soportan rawMode; caer a readline sin eco imperfecto */
      const rl = createInterface({ input, output: undefined, terminal: false });
      stderr.write("(entrada sin eco nativo)\n");
      rl.question("", (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }
    input.resume();
    input.on("data", onData);
  });
}
