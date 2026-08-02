// Service worker mínimo: só o necessário pra tornar o app instalável e
// receber push em segundo plano. De propósito NÃO faz cache de asset —
// os arquivos do build já têm hash no nome (cache busting automático do
// Vite), então cache aqui só adicionaria risco de tela em branco por
// versão presa, sem ganho real de velocidade.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Deixa o navegador buscar tudo normal, direto na rede.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { titulo: "Contigo Saúde", corpo: event.data ? event.data.text() : "" };
  }

  const titulo = dados.titulo || "Contigo Saúde";
  const opcoes = {
    body: dados.corpo || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: dados.url || "/app.html" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/app.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if (janela.url.includes(url) && "focus" in janela) return janela.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
