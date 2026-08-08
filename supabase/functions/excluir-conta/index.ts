// Edge Function: exclusão de conta de verdade (LGPD).
//
// A RPC hc_excluir_minha_conta (migration-2026-08-06-exclusao-conta.sql) já
// anonimiza todo dado pessoal, mas não consegue apagar a linha em
// auth.users — isso só é possível com a Admin API do Supabase
// (auth.admin.deleteUser), que exige a service role key. Uma função
// "security definer" comum no Postgres não tem acesso a isso; só um
// backend de confiança (esta Edge Function) tem.
//
// Fluxo:
//   1. Confirma quem está chamando usando o token de sessão de quem
//      chamou (mesma coisa que aconteceria se o client chamasse a RPC
//      direto — nenhum privilégio extra).
//   2. Roda hc_excluir_minha_conta como esse usuário (anonimiza os dados).
//   3. Com a service role key, apaga a linha em auth.users — o login deixa
//      de existir de verdade, não só os dados.
//
// Chamada esperada: POST sem corpo, com o Authorization da sessão atual
// (o supabase-js já manda isso sozinho em functions.invoke()).

import { createClient } from "npm:@supabase/supabase-js@2";

// CORS: mesma lista de origens permitidas das outras Edge Functions do
// projeto (produção, app nativo via Capacitor, localhost de dev).
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: cors });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Não autenticado." }), {
      status: 401,
      headers: cors,
    });
  }

  // Cliente "como o usuário": manda o mesmo token de quem chamou, então
  // auth.uid() dentro da RPC vira o uid de quem está pedindo a exclusão —
  // ninguém consegue apagar a conta de outra pessoa por aqui.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await comoUsuario.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Sessão inválida." }), {
      status: 401,
      headers: cors,
    });
  }
  const userId = userData.user.id;

  const { error: rpcError } = await comoUsuario.rpc("hc_excluir_minha_conta");
  if (rpcError) {
    return new Response(JSON.stringify({ error: rpcError.message }), {
      status: 500,
      headers: cors,
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    // Os dados já foram anonimizados nesse ponto; só o login que não saiu.
    // Reporta o erro pra quem chamou decidir (tentar de novo, contatar
    // suporte) em vez de fingir sucesso.
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: cors,
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
