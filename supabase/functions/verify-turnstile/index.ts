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

  return new Response(JSON.stringify({ valido: resultado.success === true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
