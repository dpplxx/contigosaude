import { useEffect, useId, useRef, useState } from "react";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

let scriptPromise = null;

function carregarScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Não foi possível carregar o Turnstile."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function turnstileConfigurado() {
  return !!SITE_KEY;
}

// Renderiza o widget do Turnstile e devolve o token gerado via onToken.
// Some sozinho (sem gerar nenhum elemento) se a site key não estiver
// configurada — mesmo padrão de degradação graciosa do resto do app.
export function TurnstileWidget({ onToken }) {
  const id = useId();
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!SITE_KEY) return;
    let ativo = true;

    carregarScript()
      .then(() => {
        if (!ativo || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            setErro("Não foi possível carregar a verificação. Recarregue a página.");
          },
        });
      })
      .catch(() => setErro("Não foi possível carregar a verificação. Recarregue a página."));

    return () => {
      ativo = false;
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;

  return (
    <div>
      <div id={id} ref={containerRef} />
      {erro && (
        <p className="text-xs mt-1" style={{ color: "#D98C6E" }}>
          {erro}
        </p>
      )}
    </div>
  );
}
