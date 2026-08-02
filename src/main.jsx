import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { iniciarSentry, SentryErrorBoundary } from "./lib/sentry.js";

iniciarSentry();

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

function TelaDeErro() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#1C2A28",
        color: "#F5EFE6",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Algo deu errado.</p>
        <p style={{ color: "#9CA8A4", marginBottom: "1.5rem" }}>
          Recarregue a página. Se continuar, tente de novo em alguns minutos.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#C6693D",
            color: "#14231F",
            border: "none",
            padding: "0.6rem 1.2rem",
            borderRadius: "0.5rem",
            cursor: "pointer",
          }}
        >
          Recarregar
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<TelaDeErro />}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>
);
