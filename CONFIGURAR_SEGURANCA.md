# Como Implementar Segurança no Supabase

## ⚡ Quick Start (5 minutos)

### Passo 1: Abrir SQL Editor do Supabase
1. Acesse [supabase.co](https://supabase.co)
2. Selecione seu projeto `saude-domiciliar`
3. Clique em **SQL Editor** (esquerda)
4. Clique em **New Query**

### Passo 2: Copiar e rodar o schema atualizado
1. Abra o arquivo `supabase/schema.sql` no seu editor
2. Copie **TODO** o conteúdo
3. Cole no SQL Editor do Supabase
4. Clique em **Run** (ou Ctrl+Enter)

✅ Pronto! Suas mudanças estão no banco.

---

## 📊 O que foi implementado

### 1️⃣ Soft Delete (Direito ao Esquecimento - LGPD)
```sql
-- Coluna deletado_em foi adicionada
ALTER TABLE fisios ADD COLUMN deletado_em TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN deletado_em TIMESTAMPTZ;

-- Quando você quer deletar: marcar como deletado
UPDATE pedidos SET deletado_em = NOW() WHERE id = 'xxx';

-- RLS automático: nunca mostra deletados
SELECT * FROM pedidos; -- nunca retorna deletados
```

**Por que:** Dá tempo para o usuário mudar de ideia (7 dias), depois deleta de verdade.

---

### 2️⃣ Auditoria Completa
```sql
-- Nova tabela: quem fez o quê, quando e de onde
SELECT * FROM auditoria;

-- Você (admin) consegue ver:
-- - tabela: qual tabela foi modificada
-- - operacao: INSERT/UPDATE/DELETE/SELECT
-- - usuario_id: quem fez
-- - dados_antigos: o que era antes
-- - dados_novos: o que é agora
-- - ip_address: de onde
-- - criada_em: quando
```

**Por que:** LGPD obriga a rastrear acesso. Se um paciente reclamar, você prova quem viu seu dado.

---

### 3️⃣ Criptografia (CREFITO)
```sql
-- Encriptar um CREFITO
SELECT hc_encriptar_crefito('CREFITO/SP 123456');
-- Retorna: (texto encriptado)

-- Descriptografar (só admins)
SELECT hc_descriptografar_crefito(crefito_encrypted);
-- Retorna: CREFITO/SP 123456
```

**Por que:** CREFITO é PII (informação pessoal identificável). Se o banco for vazado, o invasor não consegue ler.

---

### 4️⃣ Direito ao Esquecimento (LGPD)
```sql
-- Quando paciente quer deletar tudo
SELECT hc_anonimizar_paciente('id-do-paciente');

-- Resultado:
-- - Nome: "Paciente Anônimo"
-- - WhatsApp: NULL
-- - Observações: NULL
-- - Agendamentos: cancelados
-- - deletado_em: NOW()
```

**Por que:** LGPD Art. 17 = paciente tem direito de deletar tudo.

---

### 5️⃣ Limpeza Automática (90 dias)
```sql
-- Executar 1x ao mês para limpar auditoria antiga
SELECT hc_limpar_auditoria();

-- Deleta todos os registros de auditoria com +90 dias
```

**Por que:** Auditoria cresce rápido. LGPD permite manter apenas 90 dias.

---

## 🔒 Próximos Passos (Ainda Grátis)

### Faltando esta semana:
- [ ] Rodar o schema.sql atualizado no Supabase
- [ ] Testar soft delete (deletar um paciente de teste)
- [ ] Testar auditoria (verifique tabela `auditoria`)
- [ ] Configurar cron para limpar auditoria mensalmente

### Próxima semana:
- [ ] APIs de LGPD (exportar dados em JSON)
- [ ] Integrar criptografia no backend Node.js
- [ ] Logs de login/acesso

### Próximo mês:
- [ ] Integrar verificação real de CREFITO
- [ ] Implementar tokens de sessão (invés de WhatsApp)
- [ ] 2FA para admin

---

## ⚠️ Cuidado: Chave de Criptografia

**Importante:** A chave de criptografia está no código SQL:
```
'chave-segura-fisio-em-casa-2026'
```

**Não deixar exposta!** Quando for produção:
1. Criar variável de ambiente no Supabase
2. Usar `current_setting('app.encryption_key')`
3. Mudar a chave regularmente

Por enquanto (protótipo) pode ficar como está.

---

## 🧪 Teste Rápido

Após rodar o schema, teste assim no SQL Editor:

```sql
-- 1. Testar soft delete
INSERT INTO pedidos (nome, whatsapp, especialidade, cidade, bairro, urgencia)
VALUES ('Teste', '11987654321', 'Ortopédica', 'SP', 'Centro', 'Esta semana');

SELECT * FROM pedidos; -- vê o novo

UPDATE pedidos SET deletado_em = NOW() WHERE nome = 'Teste';

SELECT * FROM pedidos; -- não vê mais (soft delete funcionou!)

-- 2. Testar auditoria
SELECT * FROM auditoria; -- vê as operações acima

-- 3. Testar criptografia
SELECT hc_encriptar_crefito('CREFITO/SP 123456') as encrypted;
```

---

## 📞 Suporte

Se algo não funcionar:

1. Erro de sintaxe SQL? Verifique a versão do Postgres (Supabase usa 14+)
2. Permissões? Certifique-se que está logado como admin
3. Dúvida sobre LGPD? Veja `SEGURANCA_DADOS.md`

Qualquer erro, mande o print e a mensagem de erro.

---

**Status:** ✅ Implementado 30/07/2026
**Próxima revisão:** 01/10/2026
**Responsável:** Rangel + DPO designado
