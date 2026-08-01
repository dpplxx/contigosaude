import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// O site tem duas páginas:
//   index.html  → landing institucional, HTML puro, carrega instantâneo
//   app.html    → o aplicativo React
// Separar as duas evita que quem só está conhecendo o serviço precise baixar
// todo o bundle do app.
//
// Em produção no GitHub Pages: https://dpplxx.github.io/contigosaude/
// O build precisa saber disso. Localmente (npm run dev) o base fica em "/" e tudo funciona normal.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app.html"),
        "seo-espirito-santo": resolve(
          import.meta.dirname,
          "fisioterapia-domiciliar/espirito-santo.html"
        ),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
