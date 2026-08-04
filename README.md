# Contigo Saúde

Marketplace de fisioterapia domiciliar. O paciente pede atendimento, o
fisioterapeuta se cadastra, e o Painel faz o meio de campo: encontra quem
combina por especialidade e **distância real**, agenda, abre um chat entre os
dois e mostra as métricas do negócio.

- **Front-end:** React + Vite + Tailwind
- **Banco e login:** Supabase
- **Publicação:** GitHub Pages (automática a cada `git push`)

O site tem duas páginas:

| Endereço     | O que é                                                          |
| ------------ | ---------------------------------------------------------------- |
| `/`          | Landing institucional. HTML puro, sem JavaScript, carrega na hora |
| `/app.html`  | O aplicativo. Os botões da landing já levam para a aba certa      |

---

## 1. Criar o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) → **New project**
2. Nome sugerido: `contigo-saude`. Região: **South America (São Paulo)**
3. Guarde a senha do banco que ele pedir para criar (você não vai precisar dela
   no dia a dia, mas perder dá trabalho)

## 2. Criar as tabelas

1. No projeto novo, abra **SQL Editor** no menu lateral
2. Clique em **New query**
3. Abra o arquivo [`supabase/schema-atual.sql`](supabase/schema-atual.sql)
   deste projeto, copie **tudo** e cole no editor
4. Clique em **Run**

Deve aparecer "Success. No rows returned". Pode rodar de novo quantas vezes
quiser — o arquivo não apaga nada.

5. Depois do `schema-atual.sql`, rode também cada arquivo
   `supabase/migration-*.sql` que existir na raiz de `supabase/`, em ordem de
   data — são mudanças feitas depois que o `schema-atual.sql` foi gerado e
   ainda não foram dobradas nele. A lista completa, o que cada um faz e por
   que o projeto funciona em duas camadas (`schema-atual.sql` + migrações
   soltas) está em [`supabase/README.md`](supabase/README.md).

## 3. Criar a sua conta de acesso ao Painel

O Painel e as Métricas mostram nome, telefone e observações clínicas dos
pacientes. Só quem está nesta lista consegue abrir.

1. No Supabase, vá em **Authentication** → **Users** → **Add user** → **Create
   new user**
2. Preencha seu email e uma senha, e marque **Auto Confirm User**
3. Volte no **SQL Editor** e rode isto, trocando pelo seu email:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'seu@email.com'
on conflict (user_id) do nothing;
```

4. Ainda no Supabase, vá em **Authentication** → **Sign In / Providers** →
   **Email** e desligue **Allow new users to sign up**

O passo 4 é uma trava a mais: mesmo que alguém tente criar conta, a tabela
`admins` já barra o acesso aos dados.

## 4. Pegar as chaves e rodar no seu computador

1. No Supabase, vá em **Project Settings** → **Data API** e copie a **Project
   URL**
2. Vá em **Project Settings** → **API Keys** e copie a chave **anon** (também
   chamada de `publishable`) — **não** copie a `service_role`
3. Na pasta do projeto, faça uma cópia do arquivo `.env.example` com o nome
   `.env.local` e preencha:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

4. No terminal, dentro da pasta do projeto:

```bash
npm install
```

```bash
npm run dev
```

Abra o endereço que aparecer (normalmente `http://localhost:5173`).

> A chave `anon` aparece no código do site — isso é normal e é assim que o
> Supabase foi feito. Quem protege os dados é o RLS e as funções do
> `schema-atual.sql`, não o segredo da chave. A `service_role` é que nunca
> pode sair do painel do Supabase.

## 5. Publicar no GitHub Pages

**Criar o repositório**

1. Em [github.com/new](https://github.com/new), crie um repositório chamado
   `contigosaude`, público, **sem** README
2. No terminal, dentro da pasta do projeto:

```bash
git init && git add . && git commit -m "Contigo Saúde"
```

```bash
git branch -M main && git remote add origin https://github.com/SEU-USUARIO/contigosaude.git && git push -u origin main
```

**Guardar as chaves no GitHub**

No repositório: **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**. Crie duas:

| Nome                     | Valor                       |
| ------------------------ | --------------------------- |
| `VITE_SUPABASE_URL`      | a mesma URL do `.env.local` |
| `VITE_SUPABASE_ANON_KEY` | a mesma chave anon          |

**Ligar o Pages**

**Settings** → **Pages** → em **Source**, escolha **GitHub Actions**.

Pronto. Vá em **Actions** e acompanhe o build; quando ficar verde, o site está
em `https://SEU-USUARIO.github.io/contigosaude/`.

Daí em diante, toda vez que você quiser publicar uma mudança:

```bash
git add . && git commit -m "descrição da mudança" && git push
```

---

## Como o acesso funciona

| Quem                | Como entra                        | O que vê                                                                             |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Paciente            | WhatsApp que usou no pedido       | Só os próprios pedidos, o fisio designado e o chat                                    |
| Fisioterapeuta      | WhatsApp que usou no cadastro     | Sua agenda, suas avaliações e um resumo dos pedidos compatíveis (sem nome nem telefone) |
| Você (Painel)       | Email e senha da conta admin      | Tudo                                                                                   |

O telefone funciona como chave de acesso das duas primeiras linhas. É uma trava
fraca de propósito — o objetivo é não pedir cadastro de quem só quer testar. Se
o produto crescer, o caminho é trocar por código de confirmação via WhatsApp ou
SMS.

## Como o match por distância funciona

Paciente e fisioterapeuta informam o **CEP**. O app consulta o endereço e as
coordenadas, e guarda latitude e longitude junto com o cadastro. O
fisioterapeuta escolhe até quantos quilômetros aceita se deslocar.

O cruzamento é: mesma especialidade **e** distância dentro do raio.

Nada disso usa API paga. A consulta de CEP passa pela BrasilAPI, cai na ViaCEP
se ela estiver fora do ar, e busca as coordenadas no OpenStreetMap quando o CEP
não traz. Nenhum dos três pede chave, cadastro ou cartão. A conta de distância
acontece dentro do próprio Postgres, então **não existe custo por consulta**,
por mais que o site cresça.

Duas coisas que vale saber:

- A distância é **em linha reta**, não trajeto de carro. Para "atende a 3 km de
  você" isso é indiferente.
- Se a consulta de CEP falhar, o formulário continua funcionando: a pessoa
  digita cidade e bairro na mão e o match usa o critério de texto.

## Estrutura

```
index.html                 Landing institucional (HTML puro, sem React)
app.html                   Entrada do aplicativo
src/
  App.jsx                  Navegação, tema, notificações e sessão
  lib/
    supabase.js            Conexão
    api.js                 Todas as chamadas ao banco
    utils.js               Formatação, distância e regra de compatibilidade
    geo.js                 Consulta de CEP e coordenadas
  components/
    ui.jsx                 Botões, campos, cards, badges
    Compartilhados.jsx     Chat, campo de CEP e entrada por telefone
    Paciente.jsx           Pedido de atendimento e acompanhamento
    Fisio.jsx              Cadastro e agenda do fisioterapeuta
    Painel.jsx             Área restrita: pedidos, fisios, agendamento, backup
    Metricas.jsx           Gráficos e mapa relativo por bairro
    Login.jsx              Entrada da área restrita
supabase/
  schema-atual.sql         Estado consolidado das tabelas, RLS e funções
  migration-*.sql          Mudanças aplicadas depois do schema-atual.sql
  functions/               Edge Functions (Deno) — nem todas implantadas
  README.md                Como o esquema de migrações funciona e evolui
```

### Colocar o vídeo explicativo na landing

Suba o vídeo no YouTube como "não listado", copie o ID dele (a parte depois de
`watch?v=`) e abra o `index.html`. Perto do meio do arquivo tem um bloco
comentado começando com `VÍDEO EXPLICATIVO` — troque `SEU_ID_AQUI` pelo ID e
apague as duas linhas de comentário (`<!--` e `-->`) que envolvem a seção.

## Pendências conhecidas

- **⚠️ Atualizar o GitHub Secret `VITE_VAPID_PUBLIC_KEY`.** A chave VAPID foi
  trocada (a privada anterior tinha se perdido, nunca foi salva em lugar
  nenhum). O `.env.local` já está com a nova, mas o secret do GitHub usado
  no build de produção (`Settings → Secrets and variables → Actions`) ainda
  está com o valor antigo — troque pelo novo valor do `.env.local` antes do
  próximo deploy, senão o navegador do usuário assina a inscrição com uma
  chave que a Edge Function não reconhece.
- **Backup manual.** O Painel exporta e restaura JSON, mas quem faz o backup
  automático diário é o próprio Supabase (plano free guarda 7 dias).
- **Anti-spam simples.** Um telefone pode ter no máximo 5 pedidos abertos ao
  mesmo tempo. Não há CAPTCHA nem verificação de número.
