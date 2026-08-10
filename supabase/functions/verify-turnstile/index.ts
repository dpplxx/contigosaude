// Edge Function: confirma um token do Cloudflare Turnstile com o backend
// da Cloudflare antes de aceitar um cadastro.
//
// Chamada pelo frontend (ver src/lib/api.js → verificarTurnstile) antes de
// hc_cadastrar_fisio. Sem isso, o Turnstile no navegador (src/lib/
// turnstile.jsx) só travava o botão — não impedia quem chamasse a RPC
// direto pelo cliente Supabase, pulando a tela.
//
// PRECISA SER IMPLANTADA (`supabase functions deploy verify-turnstile`) e
// ter o secret TURNSTILE_SECRET_KEY configurado (Dashboard → Turnstile →
// seu site → Secret key — NUNCA a mesma coisa que VITE_TURNSTILE_SITE_KEY,
// que é pública) antes de funcionar em produção.
//
// Chamada esperada (POST, JSON): { "token": "..." }
// Resposta: { "valido": true|false }

import { createClient } from "npm:@supabase/supabase-js@2";

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

const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: cors });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ valido: false, erro: "token ausente" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const resposta = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: req.headers.get("cf-connecting-ip") ?? undefined,
    }),
  });

  const resultado = await resposta.json();
  const valido = resultado.success === true;

  // Grava a verificação pro auth.uid() de quem chamou, pra hc_cadastrar_fisio
  // poder confirmar server-side que ESSA conta passou pelo Turnstile antes
  // de aceitar um cadastro novo — antes disso, o widget no navegador só
  // travava o botão, e quem chamasse a RPC direto (fora da UI) pulava o
  // captcha inteiro. Ver migration-2026-08-09-turnstile-server-side.sql.
  if (valido && SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY) {
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const asUser = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await asUser.auth.getUser();
      const userId = userData?.user?.id;
      if (userId) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        await admin
          .from("turnstile_verificacoes")
          .upsert({ user_id: userId, verificado_em: new Date().toISOString() });
      }
    }
  }

  return new Response(JSON.stringify({ valido }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
