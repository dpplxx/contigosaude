# Plano de Segurança de Dados - Contigo Saúde

## 📋 Status Atual (Protótipo)

### ✅ Segurança Implementada

**1. Autenticação & Autorização**
- Login por email/senha via Supabase Auth
- RLS (Row-Level Security) no banco: anon não lê nada
- Painel: apenas admins autenticados (verificação extra na tabela `admins`)
- Isolamento por WhatsApp: cada profissional vê apenas seus pedidos

**2. Criptografia em Trânsito**
- HTTPS obrigatório (GitHub Pages)
- Conexão Supabase via SSL/TLS

**3. Documentos Jurídicos**
- ✅ Termos de Uso
- ✅ Política de Privacidade
- ✅ Declarações de Ética (COFFITO)
- ✅ Termo de Responsabilidade Profissional
- ✅ Aviso de Protótipo (dados públicos em teste)

**4. Validações Frontend**
- ✅ Portão CREFITO (formato validado)
- ✅ Checkboxes obrigatórios (consentimento)
- ✅ Validação de entrada (emails, telefones)

---

## ⚠️ Segurança Faltando (Para Produção)

### 1. **Armazenamento de Dados Sensíveis** 🔴
**Risco:** CREFITO e dados de saúde são gravados em texto plano no banco

**O que fazer:**
```sql
-- Exemplo: Encriptar CREFITO no banco
ALTER TABLE fisios ADD COLUMN crefito_encrypted text;
-- Usar pgcrypto do Postgres
UPDATE fisios 
SET crefito_encrypted = pgp_sym_encrypt(crefito, 'chave-segura')
WHERE crefito IS NOT NULL;
```

**Implementar:**
- Criptografia de repouso (pgcrypto ou similar)
- Chaves de criptografia em variável de ambiente segura
- Nunca logar dados sensíveis

---

### 2. **Verificação Real de CREFITO** 🔴
**Risco:** Portão CREFITO valida apenas formato, não se é real

**O que fazer:**
```javascript
// Integração com API do CREFITO (se disponível)
// Opção 1: API do Conselho Regional
const verificarCREFITO = async (crefito, uf) => {
  const response = await fetch(`https://crefito.api/verify`, {
    method: 'POST',
    body: JSON.stringify({ crefito, uf })
  });
  return response.json(); // { valido: true, nome: "...", ativo: true }
};

// Opção 2: Verificação por email CREFITO
// Enviar confirmação para email do registro profissional
```

**Implementar:**
- Cadastro pendente até verificação real
- Confirmação por email CREFITO
- Bloqueio automático se CREFITO inativo

---

### 3. **Isolamento de Dados** 🟡
**Risco:** Paciente pode ver dados de outro paciente se adivinhar o WhatsApp

**O que fazer:**
```sql
-- RLS mais restritivo: token + WhatsApp
-- Ao invés de usar só WhatsApp, usar token gerado por sessão
CREATE TABLE sessoes_paciente (
  id uuid PRIMARY KEY,
  telefone text NOT NULL,
  token text NOT NULL UNIQUE,
  criada_em timestamp DEFAULT now(),
  expira_em timestamp DEFAULT now() + interval '7 days'
);

-- RLS verifica token, não apenas WhatsApp
```

**Implementar:**
- Tokens de sessão com expiração (7 dias)
- Renovação automática de token
- Logout = invalidar token imediatamente
- Link de acesso único ao pedido (invés de guardar na URL)

---

### 4. **Auditoria e Logs** 🟡
**Risco:** Ninguém sabe quem acessou o quê e quando

**O que fazer:**
```sql
CREATE TABLE auditoria (
  id uuid PRIMARY KEY,
  tabela text NOT NULL,
  operacao text NOT NULL, -- INSERT/UPDATE/DELETE/SELECT
  usuario_id uuid,
  dados_antigos jsonb,
  dados_novos jsonb,
  ip_address inet,
  criada_em timestamp DEFAULT now()
);

-- Log automático via trigger
CREATE TRIGGER audit_trigger
BEFORE INSERT OR UPDATE OR DELETE ON fisios
FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
```

**Implementar:**
- Log de acesso (quem, quando, de onde)
- Log de modificações (o quê mudou)
- Retenção: 90 dias mínimo (LGPD)
- Visualização restrita a admins

---

### 5. **Dados de Saúde Sensíveis** 🔴
**Risco:** "Observações" do paciente podem conter diagnósticos

**O que fazer:**
```javascript
// Sanitizar campos de observação
const sanitizarObservacoes = (texto) => {
  // Remover informações que identifiquem diagnóstico
  const redFlags = ['HIV', 'COVID', 'depressão', 'câncer', 'diabetes'];
  redFlags.forEach(termo => {
    // Avisar paciente que não deve incluir
  });
  // Truncar para 200 caracteres
  return texto.substring(0, 200);
};

// Campo de observação: "Paciente pós-cirúrgico" ✅
// Campo de observação: "Paciente HIV+ com dor neuropática" ❌
```

**Implementar:**
- Aviso claro: "Não inclua diagnósticos"
- Truncar observações (máx 200 caracteres)
- Criptografar campo observacoes
- Mostrar histórico apenas ao fisio designado

---

### 6. **Retenção de Dados (Direito ao Esquecimento)** 🟡
**Risco:** Dados nunca são deletados, violando LGPD

**O que fazer:**
```sql
-- Campos para rastreamento de deleção
ALTER TABLE pacientes ADD COLUMN deletado_em timestamp;
ALTER TABLE fisios ADD COLUMN deletado_em timestamp;

-- Soft delete: marcar como deletado, não remover
UPDATE pacientes 
SET deletado_em = now() 
WHERE id = $1;

-- RLS automático exclui dados deletados
-- SELECT * FROM pacientes WHERE deletado_em IS NULL

-- Política de retenção:
-- - Dados com mais de 2 anos: anonimizar
-- - Pedidos cancelados: deletar após 90 dias
-- - Avaliações negativas: manter 1 ano
```

**Implementar:**
- Soft delete (não remover, marcar como deletado)
- Anonimização automática após prazo (2 anos)
- Script de limpeza automática
- Direito de acesso completo (LGPD Art. 19)
- Direito de portabilidade (API JSON dos dados)

---

### 7. **Informações do Profissional** 🟡
**Risco:** WhatsApp exposto publicamente = spam/contato direto

**O que fazer:**
```javascript
// NÃO mostrar telefone na página pública
// Mostrar apenas: nome, especialidades, localização, raio

// Contato via plataforma (chat integrado)
// WhatsApp só após agendamento confirmado

// Opção: Número intermediário (redirection service)
// Tipo: Twilio, AWS Pinpoint, ou similar
// Paciente: chama número virtual
// Número virtual: redireciona para WhatsApp do fisio
// Fisio: não vê número do paciente
```

**Implementar:**
- Nunca expor WhatsApp na página pública
- Contato via chat integrado (not WhatsApp)
- Opção futura: número intermediário
- Mascarar IP/localização do acesso

---

## 🔐 Checklist LGPD (Lei Geral de Proteção de Dados)

### Já Implementado ✅
- [ ] Aviso de coleta de dados
- [ ] Consentimento explícito para compartilhamento
- [ ] Política de Privacidade clara
- [ ] Opt-out possível
- [ ] Segurança básica (HTTPS)

### Faltando 🔴
- [ ] Direito de acesso (download de dados em JSON)
- [ ] Direito de retificação (editar dados incorretos)
- [ ] Direito de esquecimento (deletar dados)
- [ ] Direito de portabilidade (exportar em formato aberto)
- [ ] Aviso de vazamento (notificar em 72h se dados vazarem)
- [ ] DPO (Data Protection Officer) ou responsável designado
- [ ] Conformidade com Art. 32 (medidas de segurança)
- [ ] Conformidade com Art. 33 (notificação de incidentes)

---

## 📅 Prioridades para Produção

### Fase 1 (Crítico) 🚨
```
1. Verificação real de CREFITO
2. Criptografia de dados sensíveis
3. Tokens de sessão (invés de WhatsApp)
4. Logs de auditoria
5. Soft delete + anonimização
```
**Timeline:** Antes do 1º paciente real

### Fase 2 (Importante) 🟠
```
6. Direitos LGPD (acesso/portabilidade/esquecimento)
7. Número intermediário para WhatsApp
8. Alertas de segurança (login de novo IP, etc)
9. Backup automático com criptografia
10. Testes de penetração
```
**Timeline:** Primeiras 4 semanas

### Fase 3 (Melhorias) 🟡
```
11. 2FA (autenticação de dois fatores)
12. Biometria (reconhecimento facial/digital)
13. Assinatura digital de documentos
14. Conformidade com HIPAA/GDPR
15. Seguro de responsabilidade civil
```
**Timeline:** Trimestral

---

## 💰 Custos de Segurança (Estimado)

| Funcionalidade | Custo Mensal | Alternativa |
|---|---|---|
| Criptografia Supabase | R$ 0 (incluído) | - |
| Logs de auditoria | R$ 50-200 | DynamoDB + Lambda (AWS) |
| Backup criptografado | R$ 0-50 | Supabase backup automático |
| Número intermediário (Twilio) | R$ 100-500 | Vonage, AWS Pinpoint |
| Monitoramento de segurança | R$ 0-100 | Datadog, New Relic |
| DPO (terceirizado) | R$ 2.000-5.000 | Consultoria externa |
| Testes de penetração | R$ 5.000-10.000/ano | 1x ao ano |

---

## 📞 Referências LGPD para Fisioterapia

**Lei:** Lei 13.709/2018 (LGPD)
**Regulador:** Autoridade Nacional de Proteção de Dados (ANPD)
**Setor Específico:** COFFITO (Conselho de Fisioterapeutas)

**Obrigações especiais:**
- Sigilo profissional (Art. 5º)
- Consentimento do paciente (Art. 7º)
- Dados genéticos/biométricos (Art. 11)
- Direitos do titular (Art. 18-23)
- Notificação de vazamento (Art. 33)

**Multas:** Até R$ 50M ou 2% do faturamento (máximo)

---

## ✅ Próximos Passos

### Imediatamente (Esta Semana)
1. [ ] Criar tabela de auditoria e triggers
2. [ ] Implementar soft delete
3. [ ] Adicionar API de exportação LGPD

### Curto Prazo (1 Mês)
1. [ ] Integrar API de verificação CREFITO
2. [ ] Implementar tokens de sessão
3. [ ] Criptografar campos sensíveis
4. [ ] DPO/responsável designado

### Médio Prazo (3 Meses)
1. [ ] Testes de penetração profissionais
2. [ ] Certificação de conformidade
3. [ ] Seguro de responsabilidade civil
4. [ ] Treinamento interno de segurança

---

**Última atualização:** 30/07/2026
**Responsável:** Rangel / DPO designado
**Próxima revisão:** 01/10/2026
