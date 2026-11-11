import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Recursos de pdf.js (fuentes estándar, cmaps y decodificadores wasm) servidos desde el mismo origen. */
function pdfjsAssets(): Plugin {
  const src = path.join(HERE, "node_modules", "pdfjs-dist");
  const dest = path.join(HERE, "client", "public", "pdfjs");
  return {
    name: "linky-pdfjs-assets",
    buildStart() {
      for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
        const from = path.join(src, dir);
        if (!existsSync(from)) continue;
        mkdirSync(path.join(dest, dir), { recursive: true });
        cpSync(from, path.join(dest, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: path.join(HERE, "client"),
  publicDir: path.join(HERE, "client", "public"),
  plugins: [react(), pdfjsAssets()],
  build: {
    outDir: path.join(HERE, "dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    // Nada incrustado como data: (fuentes, imágenes): todo se sirve como archivo y la CSP queda estricta.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:4780", changeOrigin: false } },
  },
});
