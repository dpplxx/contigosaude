import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Sem service worker registrado, o navegador nem oferece "instalar app" e
// push em segundo plano não funciona — a Notification API sozinha só
// dispara com a aba aberta.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // PWA é um extra, não uma dependência — se o navegador recusar, o
      // resto do app continua funcionando normal.
    });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
