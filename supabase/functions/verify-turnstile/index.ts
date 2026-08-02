// Edge Function: confirma um token do Cloudflare Turnstile com o backend
// da Cloudflare antes de aceitar um cadastro/pedido.
//
// AINDA NÃO IMPLANTADA nem chamada por lugar nenhum do app. Hoje o
// Turnstile (src/lib/turnstile.js) só trava o botão de enviar no
// navegador — filtra bot simples que nem consegue gerar um token, mas não
// impede quem chama hc_criar_pedido/hc_cadastrar_fisio direto pelo cliente
// Supabase, pulando a tela. Fechar essa lacuna de verdade significa trocar
// o fluxo de "chamar a RPC direto do frontend" por "chamar este Edge
// Function primeiro" — mudança de fluxo, não só configuração, por isso
// não fiz agora.
//
// Antes de implantar (`supabase functions deploy verify-turnstile`):
// configurar o secret TURNSTILE_SECRET_KEY (Dashboard → Turnstile → seu
// site → Secret key — NUNCA a mesma coisa que VITE_TURNSTILE_SITE_KEY,
// que é pública). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem
// automaticamente em todo Edge Function do projeto.
//
// Chamada esperada (POST, JSON): { "token": "..." }
// Resposta: { "valido": true|false }
//
// Uso pretendido depois que existir: o frontend chama este função com o
// token do Turnstile ANTES de chamar hc_criar_pedido/hc_cadastrar_fisio;
// só segue se "valido" vier true. Não dá pra verificar dentro da própria
// RPC do Postgres porque isso exigiria uma chamada HTTP síncrona de dentro
// do banco (pg_net é assíncrono, não serve pra bloquear no mesmo request).

const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ valido: false, erro: "token ausente" }), {
      status: 400,
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
    headers: { "Content-Type": "application/json" },
  });
});
