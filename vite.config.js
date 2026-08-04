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
// Base relativa ("./") no build de produção: os caminhos dos assets ficam
// relativos ao próprio HTML, então o mesmo build funciona tanto em
// https://contigosaude.com.br/ (domínio próprio, raiz) quanto em
// https://dpplxx.github.io/contigosaude/ (enquanto o DNS do domínio não
// propaga) — sem precisar trocar configuração e reimplantar quando o domínio
// entrar no ar. No dev server (npm run dev) fica em "/" porque é assim que o
// Vite espera servir localmente.
//
// Modo "capacitor" (npm run build:mobile): gera um build separado em
// dist-mobile com as mesmas duas páginas do site (landing + app), pra quem
// abre o app pelo ícone ver a mesma tela inicial de quem entra pelo site —
// só sem a página de SEO "seo-espirito-santo", que não faz sentido dentro
// do app instalado.
export default defineConfig(({ command, mode }) => {
  const isMobile = mode === "capacitor";

  return {
    base: command === "build" ? "./" : "/",
    plugins: [react(), tailwindcss()],
    build: isMobile
      ? {
          outDir: "dist-mobile",
          rollupOptions: {
            input: {
              landing: resolve(import.meta.dirname, "index.html"),
              app: resolve(import.meta.dirname, "app.html"),
            },
            output: {
              entryFileNames: "assets/[name]-[hash].js",
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        }
      : {
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
  };
});
