// Edge Function: manda Web Push de verdade (chega mesmo com o app fechado).
//
// IMPLANTADA em 2026-08-02. Os 3 secrets do projeto (VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT) estão configurados. SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY existem automaticamente em todo Edge Function
// do projeto.
//
// A chave VAPID atual é um par novo, gerado nesse deploy — o par anterior
// (o que só tinha a pública em VITE_VAPID_PUBLIC_KEY) tinha a privada
// perdida, nunca foi salva em lugar nenhum. Quem já tinha ativado
// notificação antes precisa reativar (a inscrição antiga não bate mais com
// a chave nova).
//
// Chamada esperada (POST, JSON):
//   { "userId": "uuid-da-conta", "titulo": "...", "corpo": "...", "url": "/app.html" }
//
// Quem dispara: supabase/migration-2026-08-02-push-triggers.sql — triggers
// em agendamentos (INSERT) e mensagens (INSERT) chamam esta função via
// pg_net.http_post(), assíncrono, sem travar a transação que escreveu a
// linha.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// CORS: antes esta função respondia "Access-Control-Allow-Origin: *" —
// qualquer site da internet podia chamar. Restrito à lista de origens que o
// app realmente usa (domínio de produção, app nativo Android/iOS via
// Capacitor, e localhost de desenvolvimento).
const ALLOWED_ORIGINS = new Set([
  "https://contigosaude.com.br",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost:5173",
]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@contigosaude.com.br";
// Segredo compartilhado só com o trigger do Postgres (hc_disparar_push, ver
// migration-2026-08-09-fix-send-push-auth.sql) — sem isso, qualquer um com
// a anon key podia chamar esta function com um userId arbitrário e ler/
// mandar push pra inscrição de qualquer conta, já que a Authorization
// sozinha (a anon key) não prova quem está chamando. Configure com
// `supabase secrets set PUSH_INTERNAL_SECRET=<valor>` — o mesmo valor vai
// pro Postgres via ALTER DATABASE (ver a migration).
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET");

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: cors });
  }

  if (!PUSH_INTERNAL_SECRET || req.headers.get("x-internal-secret") !== PUSH_INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), {
      status: 401,
      headers: cors,
    });
  }

  const { userId, titulo, corpo, url } = await req.json();
  if (!userId || !titulo) {
    return new Response(JSON.stringify({ error: "userId e titulo são obrigatórios" }), {
      status: 400,
      headers: cors,
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
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
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
