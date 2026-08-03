# Esquema do banco — como aplicar e como evolui

Este projeto não usa uma ferramenta de migração (Flyway, Prisma Migrate,
`supabase migration`). O controle é manual, por arquivo `.sql`, e segue duas
camadas:

1. **`schema-atual.sql`** — o estado consolidado do banco numa certa data.
   Reproduz tudo que existia em produção naquele momento de uma vez só,
   dobrando (fold) várias migrações antigas numa única fonte.
2. **`migration-AAAA-MM-DD-descricao.sql`** — mudanças aplicadas *depois* que
   o `schema-atual.sql` foi gerado. Cada arquivo é independente e datado.

## Configurando um projeto novo do zero

1. Cole `schema-atual.sql` inteiro no SQL Editor do Supabase e rode.
2. Rode, **em ordem de data**, todo arquivo `migration-*.sql` que existir na
   raiz de `supabase/` além do `schema-atual.sql`. Na data deste documento,
   são estes (mais recentes por último):

   | Arquivo | O que adiciona |
   | --- | --- |
   | `migration-2026-08-02-verificar-crefito.sql` | Verificação manual de CREFITO pelo admin |
   | `migration-2026-08-02-admin-rpc-painel.sql` | RPCs administrativas do Painel (agendar, status, avaliar) — fecha a última escrita direta em tabela sem passar por função `hc_*` |
   | `migration-2026-08-02-push-subscriptions.sql` | Tabela `push_subscriptions` + RPCs de inscrição/remoção |
   | `migration-2026-analytics.sql` | `analytics_events` — telemetria genérica de eventos de UI (jsonb livre) |
   | `migration-2026-08-02-marketplace-analytics.sql` | `marketplace_eventos` — telemetria estruturada do funil (busca/resultado/whatsapp), colunas fixas pra agregação SQL direta |
   | `migration-2026-08-02-avaliacoes-moderacao.sql` | Nome do avaliador, denúncia pública e fila de moderação em `avaliacoes` |
   | `migration-perfil-publico.sql` | `hc_obter_fisio_publico()` — perfil individual do profissional, acessível sem login via `?fisio=UUID` |

3. Confira no final: `\dt public.*` deve listar `admins`, `agendamentos`,
   `analytics_events`, `auditoria`, `avaliacoes`, `avaliacoes_denuncias`,
   `fisios`, `marketplace_eventos`, `mensagens`, `pedidos`,
   `push_subscriptions`.

Todos os arquivos são idempotentes na medida do possível (`create table if
not exists`, `create or replace function`, `drop policy if exists` antes de
recriar) — rodar de novo não deveria quebrar nada, mas não foram escritos
para rodar fora de ordem.

## Quando gerar um `schema-atual.sql` novo

Quando o número de `migration-*.sql` soltos ficar grande de novo (a última
consolidação dobrou 13 arquivos em 1), gere um `schema-atual-NOVO.sql`:
para cada objeto (tabela, função, policy) que aparece em mais de um arquivo,
o *último* arquivo que mexeu nele vence. Depois:

1. Rode o novo arquivo consolidado contra um projeto Supabase **vazio** e
   confirme que reproduz o estado de produção sem erro.
2. Mova os arquivos antigos (o `schema-atual.sql` anterior + os
   `migration-*.sql` que ele absorveu) para `supabase/archive/`.
3. Atualize a tabela acima e o cabeçalho do novo `schema-atual.sql` com a
   lista do que foi dobrado, na ordem em que rodou de verdade em produção
   (o cabeçalho atual documenta isso pros 13 arquivos anteriores — siga o
   mesmo formato).

Depois disso, `schema-atual.sql` antigo *nunca mais deve ser editado* —
ele deixaria de bater com o banco real. Toda mudança nova vira um
`migration-AAAA-MM-DD-descricao.sql` novo.

## Outras pastas

- **`archive/`** — migrações já dobradas no `schema-atual.sql` atual, mais o
  `schema.sql` original (primeira versão do banco, antes de qualquer
  migração). Histórico só — não rode nada daqui.
- **`functions/`** — Edge Functions (Deno). Nem toda função aqui está
  implantada; cada arquivo documenta no topo se já está em produção ou não
  (ver `functions/send-push/index.ts` para um exemplo de função pronta mas
  ainda não implantada, e por quê).
- **`tests/`** — testes pgTAP das RPCs de confiança (autoavaliação, dupla
  avaliação, etc.). Rodam contra um Postgres local, não contra produção.

## Aplicando via `psql` direto (sem colar no SQL Editor)

Se preferir rodar por linha de comando em vez do SQL Editor do dashboard:

```bash
psql "postgresql://postgres.SEU_PROJETO:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/schema-atual.sql
```

A connection string (formato URI) fica em **Project Settings → Database →
Connection string** no Supabase — use a aba **URI**, não a **PSQL** (essa
última omite a senha). `ON_ERROR_STOP=1` faz o `psql` parar no primeiro erro
em vez de seguir tentando os comandos depois, o que evita aplicar um arquivo
pela metade sem perceber.
