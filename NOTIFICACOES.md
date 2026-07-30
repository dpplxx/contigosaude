# 📧 Configuração de Notificações

Este guia explica como ativar notificações por email quando há novos pedidos.

## Opções de Integração

### Opção 1: Supabase Email (Recomendado - Fácil)
Supabase oferece um serviço de email integrado (limitado, mas gratuito).

**Passos:**
1. Vá para seu projeto Supabase → Settings → Email
2. Configure o domínio de envio
3. Cole este código em `supabase/functions/notify-new-pedido/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const { pedido_id, email_destino, nome_paciente } = await req.json()
  
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  )

  const { error } = await supabase.auth.admin.sendRawUserConfirmationEmail({
    email: email_destino,
    // Usar template customizado
  })

  return new Response(
    JSON.stringify({ success: !error, error }),
    { headers: { "Content-Type": "application/json" } }
  )
})
```

### Opção 2: SendGrid (Recomendado - Confiável)
Serviço profissional de email com plano gratuito.

**Passos:**
1. Criar conta em [sendgrid.com](https://sendgrid.com)
2. Gerar API Key
3. Adicionar variável de ambiente: `SENDGRID_API_KEY=sua_chave`
4. Criar função:

```typescript
// supabase/functions/notify-sendgrid/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  const { pedido_id, email, nome_paciente, especialidade } = await req.json()
  
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SENDGRID_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email }],
        subject: `Novo pedido: ${especialidade}`
      }],
      from: { email: "noreply@contisosaude.com" },
      content: [{
        type: "text/html",
        value: `<h2>Novo pedido em sua região!</h2><p>${nome_paciente} solicitou ${especialidade}. Acesse o painel para ver detalhes.</p>`
      }]
    })
  })

  return new Response(JSON.stringify({ success: response.ok }))
})
```

### Opção 3: Twilio (Para SMS)
Notificações por WhatsApp/SMS.

**Passos:**
1. Criar conta em [twilio.com](https://twilio.com)
2. Gerar credenciais (Account SID, Auth Token)
3. Chamar API Twilio quando há novo pedido

```typescript
// Enviar WhatsApp automático
const twilio = require("twilio")(accountSid, authToken)
await twilio.messages.create({
  body: `Novo pedido: ${especialidade} em ${cidade}. Clique para ver: https://app.contisosaude.com`,
  from: "whatsapp:+5511987654321",
  to: `whatsapp:${numero_fisio}`
})
```

## Implementação No App

### 1. Atualizar `hc_criar_pedido` para chamar notificações:

```sql
-- Após inserir o pedido, chamar a função de notificação
perform hc_notificar_fisios(v_id);
```

### 2. Criar endpoint que dispara notificações:

No `src/lib/api.js`, adicionar:

```javascript
export async function notificarNovosPedidos(pedidoId) {
  return rpc("hc_notificar_fisios", { 
    p_pedido_id: pedidoId 
  })
}
```

### 3. Chamar ao criar pedido:

```javascript
// Em src/components/BuscaFisios.jsx
await criarPedido(form)
await notificarNovosPedidos(resultado.pedido_id)
```

## Variáveis de Ambiente

Adicione ao `.env.local` e GitHub Secrets:

```
SENDGRID_API_KEY=seu_api_key
TWILIO_ACCOUNT_SID=seu_sid
TWILIO_AUTH_TOKEN=seu_token
```

## Teste

Para testar notificações localmente:

```bash
# Criar um pedido de teste
curl -X POST http://localhost:54321/functions/v1/notify-sendgrid \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","nome_paciente":"Maria","especialidade":"Ortopédica"}'
```

## Próximos Passos

- [ ] Escolher serviço de email (SendGrid recomendado)
- [ ] Adicionar API key ao GitHub Secrets
- [ ] Testar fluxo de notificação
- [ ] Implementar UI de preferências no app (fisio pode desativar notificações)
