import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN;

// Campos que nunca podem sair daqui — o app lida com dado de saúde, e um
// stack trace pode acabar carregando o corpo de uma requisição que contém
// nome ou WhatsApp de paciente/fisio.
const CAMPOS_SENSIVEIS = ["nome", "whatsapp", "email", "observacoes", "comentario"];

function removerDadosSensiveis(valor) {
  if (Array.isArray(valor)) return valor.map(removerDadosSensiveis);
  if (valor && typeof valor === "object") {
    const limpo = {};
    for (const [chave, v] of Object.entries(valor)) {
      limpo[chave] = CAMPOS_SENSIVEIS.includes(chave.toLowerCase())
        ? "[removido]"
        : removerDadosSensiveis(v);
    }
    return limpo;
  }
  return valor;
}

export function iniciarSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // De propósito SEM replay e SEM captura de corpo de requisição/resposta
    // (as integrações default do Sentry não ligam isso sozinhas, mas fica
    // registrado aqui pra quem for mexer depois não achar que é só ligar
    // Sentry.replayIntegration() sem pensar duas vezes).
    integrations: [],
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        if (event.request.data) event.request.data = removerDadosSensiveis(event.request.data);
      }
      if (event.extra) event.extra = removerDadosSensiveis(event.extra);
      if (event.user) event.user = undefined;
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Breadcrumb de fetch/xhr pode incluir a URL com querystring ou o
      // corpo do POST (ex.: criar pedido) — mais seguro descartar esse tipo
      // de breadcrumb inteiro do que tentar limpar campo por campo.
      if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") return null;
      return breadcrumb;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
