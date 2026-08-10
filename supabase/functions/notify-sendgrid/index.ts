import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

// CORS: antes esta função respondia "Access-Control-Allow-Origin: *" —
// qualquer site da internet podia chamar. Restrito à lista de origens que o
// app realmente usa (domínio de produção, app nativo Android/iOS via
// Capacitor, e localhost de desenvolvimento).
const ALLOWED_ORIGINS = new Set([
  "https://contigosaude.com.br",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost:5173",
])

function corsHeaders(req) {
  const origin = req.headers.get("origin") ?? ""
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}

// Sem isso, qualquer um com a anon key (é pública, vai pro navegador de
// todo mundo) podia chamar esta function direto e mandar email arbitrário
// saindo de contato@contigosaude.com.br — um relay de phishing de graça.
// Só quem tem uma sessão válida no app pode disparar.
async function usuarioAutenticado(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader) return null

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) return null

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await db.auth.getUser()
  if (error || !data?.user) return null
  return data.user
}

// Escapa os campos que vêm do chamador antes de colocar no HTML do email —
// sem isso, alguém podia mandar `especialidade` ou `nome_paciente` com tags
// HTML e injetar conteúdo (ex: outro link de "phishing") no email que sai
// do domínio da empresa.
function escaparHtml(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: cors })
  }

  const usuario = await usuarioAutenticado(req)
  if (!usuario) {
    return new Response(JSON.stringify({ error: "Não autenticado." }), {
      status: 401,
      headers: cors,
    })
  }

  const {
    email,
    nome_paciente,
    especialidade,
    pedido_id,
    cidade,
    bairro,
  } = await req.json()

  const sendgridApiKey = Deno.env.get("SENDGRID_API_KEY")
  if (!sendgridApiKey) {
    return new Response(
      JSON.stringify({ error: "SENDGRID_API_KEY not configured" }),
      { status: 500, headers: cors }
    )
  }

  const emailBody = `
    <h2>🏥 Novo pedido de fisioterapia!</h2>
    <p>Um paciente solicitou atendimento de <strong>${escaparHtml(especialidade)}</strong> em <strong>${escaparHtml(cidade)}, ${escaparHtml(bairro)}</strong>.</p>
    <p><strong>Paciente:</strong> ${escaparHtml(nome_paciente)}</p>
    <p>Acesse seu painel para ver os detalhes e entrar em contato.</p>
    <a href="https://dpplxx.github.io/contigosaude/" style="display: inline-block; background: #E3A873; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Ver painel</a>
  `

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
            subject: `Novo pedido: ${especialidade} em ${cidade}`,
          },
        ],
        from: { email: "contato@contigosaude.com.br", name: "Contigo Saúde" },
        content: [
          {
            type: "text/html",
            value: emailBody,
          },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return new Response(JSON.stringify({ error, status: response.status }), {
        status: response.status,
        headers: cors,
      })
    }

    return new Response(JSON.stringify({ success: true, pedido_id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: cors,
    })
  }
})
