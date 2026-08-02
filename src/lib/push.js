import { salvarPushSubscription, removerPushSubscription } from "./api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// PushManager.subscribe() exige a chave VAPID em Uint8Array, não na string
// base64url que ela vem formatada.
function base64UrlParaUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSuportado() {
  return "serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC_KEY;
}

// Pede permissão do navegador e, se concedida, cria a inscrição de push de
// verdade (não só a Notification API, que só dispara com a aba aberta) e
// salva no Supabase pra essa conta.
export async function ativarPush() {
  if (!pushSuportado()) {
    throw new Error("Este navegador não suporta notificações em segundo plano.");
  }

  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") {
    throw new Error("Permissão de notificação negada.");
  }

  const registro = await navigator.serviceWorker.ready;
  let inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) {
    inscricao = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlParaUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = inscricao.toJSON();
  await salvarPushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });

  return inscricao;
}

export async function desativarPush() {
  if (!("serviceWorker" in navigator)) return;
  const registro = await navigator.serviceWorker.getRegistration();
  const inscricao = await registro?.pushManager.getSubscription();
  if (!inscricao) return;

  await removerPushSubscription(inscricao.endpoint).catch(() => {});
  await inscricao.unsubscribe();
}
