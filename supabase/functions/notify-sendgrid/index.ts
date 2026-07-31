import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: { "Access-Control-Allow-Origin": "*" } })
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
      { status: 500 }
    )
  }

  const emailBody = `
    <h2>🏥 Novo pedido de fisioterapia!</h2>
    <p>Um paciente solicitou atendimento de <strong>${especialidade}</strong> em <strong>${cidade}, ${bairro}</strong>.</p>
    <p><strong>Paciente:</strong> ${nome_paciente}</p>
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
        from: { email: "contato@contisosaude.com", name: "Contigo Saúde" },
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
      })
    }

    return new Response(JSON.stringify({ success: true, pedido_id }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    })
  }
})
