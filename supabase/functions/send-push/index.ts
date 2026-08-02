// Edge Function: manda Web Push de verdade (chega mesmo com o app fechado).
//
// AINDA NÃO IMPLANTADA. Escrita e pronta pra revisão, mas subir isso exige
// `supabase functions deploy send-push` (ou o botão de deploy no Dashboard),
// que só quem tem acesso à CLI/conta do projeto pode rodar — mesma
// restrição de sempre: nenhuma automação mexe nessa conta.
//
// Antes de implantar, configurar 3 secrets do projeto (Dashboard → Edge
// Functions → send-push → Secrets, ou `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — mesma chave pública que está em VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY  — a chave privada do mesmo par (NUNCA vai pro Git)
//   VAPID_SUBJECT      — "mailto:contato@contigosaude.com.br" (ou similar)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente em
// todo Edge Function do projeto, não precisa configurar.
//
// Chamada esperada (POST, JSON):
//   { "userId": "uuid-da-conta", "titulo": "...", "corpo": "...", "url": "/app.html" }
//
// Quem dispara essa chamada é o próximo passo depois do deploy — por
// exemplo, trocar o TODO de hc_notificar_fisios (supabase/schema-atual.sql)
// por uma chamada via pg_net, ou o próprio frontend depois de
// hc_fechar_agendamento/hc_criar_pedido. Não fiz isso ainda porque chamar
// uma função que não existe em produção só quebraria o fluxo — é o passo
// seguinte, depois que isto estiver implantado.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@contigosaude.com.br";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const { userId, titulo, corpo, url } = await req.json();
  if (!userId || !titulo) {
    return new Response(JSON.stringify({ error: "userId e titulo são obrigatórios" }), {
      status: 400,
    });
  }

  // Service role: só um Edge Function de confiança pode ler
  // push_subscriptions de qualquer usuário — é por isso que a tabela não
  // tem policy nenhuma pra "authenticated" além do Painel admin.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: inscricoes, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const payload = JSON.stringify({ titulo, corpo: corpo ?? "", url: url ?? "/app.html" });

  const resultados = await Promise.allSettled(
    (inscricoes ?? []).map((s) =>
      webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        payload
      )
    )
  );

  // Inscrição que voltou 404/410 morreu do lado do navegador (desinstalou,
  // trocou de conta, etc.) — apaga pra não tentar de novo pra sempre.
  const mortas = (inscricoes ?? []).filter((_, i) => {
    const r = resultados[i];
    return r.status === "rejected" && [404, 410].includes(r.reason?.statusCode);
  });
  if (mortas.length > 0) {
    await db.from("push_subscriptions").delete().in("id", mortas.map((s) => s.id));
  }

  return new Response(
    JSON.stringify({
      enviados: resultados.filter((r) => r.status === "fulfilled").length,
      falharam: resultados.filter((r) => r.status === "rejected").length,
      inscricoes_removidas: mortas.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
