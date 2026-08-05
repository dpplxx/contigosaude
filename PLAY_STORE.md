# Ficha da loja — Google Play Console

Rascunho pronto pra colar. Ajuste o que quiser antes de publicar — é texto, não código.

---

## Nome do app

Contigo Saúde

## Descrição curta (até 80 caracteres)

```
Fisioterapia domiciliar perto de você, sem taxa para o paciente.
```
(66 caracteres)

## Descrição completa (até 4000 caracteres)

```
Precisa de fisioterapia em casa? O Contigo Saúde conecta você a fisioterapeutas que atendem na sua região — sem taxa nenhuma para o paciente.

COMO FUNCIONA
1. Diga seu CEP e o que você precisa
2. A gente mostra fisioterapeutas que atendem sua região, com distância e avaliações de outros pacientes
3. Você combina tudo direto com o profissional pelo WhatsApp

PARA PACIENTES
• Busca gratuita, sem cadastro obrigatório
• Veja avaliações reais de outros pacientes antes de escolher
• Acompanhe seus atendimentos e histórico em um só lugar
• Fale direto com o fisioterapeuta pelo WhatsApp

PARA FISIOTERAPEUTAS
• Cadastro gratuito com verificação de registro no CREFITO
• Apareça para pacientes da sua região de atuação
• Gerencie seus atendimentos pelo aplicativo
• Construa reputação com avaliações públicas de pacientes atendidos

O Contigo Saúde é uma ferramenta de conexão entre pacientes e profissionais — não presta serviços de saúde nem substitui a avaliação de um fisioterapeuta.
```

## Categoria

Medical (ou "Saúde e boa forma", dependendo de como o Play Console traduzir a categoria "Medical" pro seu idioma)

## Ícone / gráfico de destaque

Já prontos em [resources/icon.png](resources/icon.png) e o app já usa o ícone gerado em `android/app/src/main/res/mipmap-*`. Falta só o "banner de destaque" (1024×500) — não existe ainda, é uma peça de arte separada do ícone.

## Screenshots

Preciso rodar o app num emulador ou celular real pra capturar — isso ainda está pendente (ver observação sobre o emulador). O Play Console pede no mínimo 2 por tipo de dispositivo (celular obrigatório).

---

## Formulário de segurança de dados (Data safety)

Isso é um questionário estruturado dentro do Play Console, não texto livre — aqui vai o que responder em cada campo, com base no que a [política de privacidade](privacidade.html) descreve:

**O app coleta ou compartilha algum dos tipos de dados do usuário?** Sim

| Categoria | Coletado? | Compartilhado com terceiros? | Finalidade |
|---|---|---|---|
| Nome | Sim | Não (só entre paciente/fisio, que já é o propósito do app) | Funcionalidade do app |
| E-mail | Sim | Não | Conta de usuário, funcionalidade do app |
| Número de telefone | Sim (WhatsApp) | Não | Funcionalidade do app |
| Endereço | Sim (CEP → cidade/bairro aproximado) | Não | Funcionalidade do app |
| Localização aproximada | Sim (derivada do CEP, não GPS) | Não | Funcionalidade do app |
| Outras informações de saúde | Sim (motivo do atendimento, quando o paciente opta por informar) | Não | Funcionalidade do app |
| Mensagens no app | Sim (chat entre paciente e fisio) | Não | Funcionalidade do app |
| Identificadores do dispositivo | Sim (inscrição de notificação push) | Não | Funcionalidade do app |
| Relatórios de falha | Sim (via Sentry, dados sensíveis removidos automaticamente) | Sim (processador terceirizado — Sentry) | Diagnóstico |

**Os dados são criptografados em trânsito?** Sim (HTTPS)

**O usuário pode pedir a exclusão dos dados?** Sim — pelo e-mail de contato na política de privacidade

**Todos os dados coletados são opcionais ou algum é obrigatório?** Nome e WhatsApp são obrigatórios pra usar o serviço (é como o fisioterapeuta entra em contato); o resto varia por tela.

---

## Classificação de conteúdo (questionário IARC)

Dentro do Play Console, em "Classificação de conteúdo": o questionário pergunta sobre violência, conteúdo sexual, drogas, jogos de azar etc. — pra esse app a resposta é "não" pra praticamente tudo, já que é uma ferramenta de agendamento de serviço de saúde, sem conteúdo gerado publicamente além de avaliações moderadas. Resultado esperado: classificação livre ("Livre" / "Everyone").

---

## Pendências que só você resolve

- [ ] Conta no Google Play Console (taxa única de US$25)
- [ ] Screenshots reais do app (ver observação sobre o emulador nesta conversa)
- [ ] Banner de destaque 1024×500 (arte gráfica separada do ícone)
- [ ] Revisar e colar este texto no Play Console
