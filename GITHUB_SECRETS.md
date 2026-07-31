# Configurar GitHub Secrets para Deploy em Produção

Para que o app funcione em produção (GitHub Pages), você precisa adicionar 3 variáveis de ambiente como **GitHub Secrets**.

## Como adicionar GitHub Secrets

1. Vá para: **GitHub.com → seu repositório → Settings → Secrets and variables → Actions**
2. Clique em **New repository secret**
3. Adicione cada variável abaixo

## Variáveis necessárias

### 1. `VITE_SUPABASE_URL`
**Valor:** URL do seu projeto Supabase (ex: `https://abc123.supabase.co`)

**Como encontrar:**
- Abra seu projeto no Supabase
- Vá para **Settings → API**
- Copie o valor em **Project URL**

### 2. `VITE_SUPABASE_ANON_KEY`
**Valor:** Chave pública do Supabase (ex: `eyJhbGc...`)

**Como encontrar:**
- Mesmo lugar: **Settings → API**
- Copie o valor em **anon public**

### 3. `VITE_PAINEL_PASSWORD`
**Valor:** Senha para desbloquear o painel (qualquer string que você escolher)

**Exemplo:** `minha-senha-segura-123`

## Verificar se funcionou

Após adicionar os 3 secrets:

1. Faça um `git push` para a branch `main`
2. Vá para **Actions** no GitHub
3. Veja o workflow **"Publicar no GitHub Pages"** rodando
4. Acesse seu app em: `https://dpplxx.github.io/contigosaude/`
5. Se a landing page carregar (não ficar em branco), funcionou! ✅

## Se o app ficar em branco em produção

Significa que as chaves não foram configuradas. Verifique:

1. Os 3 secrets estão no repositório? (`Settings → Secrets`)
2. Os nomes estão **exatamente** assim (case-sensitive)?
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PAINEL_PASSWORD`
3. Fez um `git push` após adicionar os secrets?

## Próximos passos após produção estar funcionando

1. **Testar notificações** → Configure SendGrid e teste envio de emails
2. **Implementar autenticação de paciente** → Login/Registro com email
3. **Ativar RLS nas tabelas** → Garantir segurança dos dados
