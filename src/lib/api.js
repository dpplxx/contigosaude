import { supabase, supabaseConfigurado } from "./supabase";

function cliente() {
  if (!supabaseConfigurado) {
    throw new Error(
      "O app está sem as chaves do Supabase. Confira o arquivo .env.local."
    );
  }
  return supabase;
}

async function rpc(nome, params) {
  const { data, error } = await cliente().rpc(nome, params);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Formulários públicos
// ---------------------------------------------------------------------------

export function cadastrarFisio(form) {
  const valor = parseFloat(String(form.valorSessao).replace(",", "."));
  return rpc("hc_cadastrar_fisio", {
    p_nome: form.nome,
    p_whatsapp: form.whatsapp,
    p_especialidades: form.especialidades,
    p_cidade: form.cidade,
    p_formacao: form.formacao,
    p_bairros: form.bairros || [],
    p_resumo: form.resumo || null,
    p_disponibilidade: form.disponibilidade || null,
    p_valor_sessao: isNaN(valor) ? null : valor,
    p_cep: form.cep || null,
    p_uf: form.uf || null,
    p_lat: form.lat ?? null,
    p_lng: form.lng ?? null,
    p_raio_km: Number(form.raioKm) || 10,
    p_crefito: form.crefito || null,
    p_crefito_uf: form.crefinoUf || null,
  });
}

// Confirma no servidor que o token do Turnstile é legítimo (o widget no
// navegador só filtra bot que nem consegue gerar token — sem essa checagem,
// quem chamasse cadastrarFisio() direto pelo cliente Supabase pulava o
// captcha inteiro). Se a Edge Function ainda não estiver implantada, o erro
// sobe pra quem chamou tratar.
export async function verificarTurnstile(token) {
  const { data, error } = await cliente().functions.invoke("verify-turnstile", {
    body: { token },
  });
  if (error) throw error;
  return data?.valido === true;
}

// O painel do fisio usa a conta logada, não mais um WhatsApp digitado —
// veja migration-fisio-auth.sql.
export async function meuPainelFisio() {
  const data = await rpc("hc_meu_painel_fisio");
  return data || { fisio: null };
}

// Sobe a foto pro bucket público "fotos-fisios", numa pasta com o próprio
// user_id (é o que a policy do storage exige), e salva a URL no cadastro.
export async function enviarFotoFisio(arquivo) {
  const db = cliente();
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError) throw userError;
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Você precisa estar logado para enviar uma foto.");

  const extensao = arquivo.name.split(".").pop()?.toLowerCase() || "jpg";
  const caminho = `${userId}/foto.${extensao}`;

  const { error: uploadError } = await db.storage
    .from("fotos-fisios")
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
  if (uploadError) throw uploadError;

  const { data: urlData } = db.storage.from("fotos-fisios").getPublicUrl(caminho);
  // Evita que o navegador mostre a foto antiga em cache depois de trocar.
  const fotoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  await rpc("hc_atualizar_foto_fisio", { p_foto_url: fotoUrl });
  return fotoUrl;
}

export async function registrarClique(fisioId) {
  try {
    await rpc("hc_registrar_clique", { p_fisio_id: fisioId });
  } catch {
    // O contador é só métrica: se falhar, não vale travar o clique do usuário.
  }
}

// ---------------------------------------------------------------------------
// Área do paciente logado
// ---------------------------------------------------------------------------

export async function meusPedidos() {
  const data = await rpc("hc_meus_pedidos");
  return data || [];
}

// ---------------------------------------------------------------------------
// Analytics do marketplace
// ---------------------------------------------------------------------------

function sessaoMarketplace() {
  try {
    const chave = "contigo_marketplace_session";

    let id = localStorage.getItem(chave);

    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      localStorage.setItem(chave, id);
    }

    return id;
  } catch {
    return null;
  }
}

export async function registrarEventoMarketplace({
  tipo,
  fisioId = null,
  especialidade = null,
  cidade = null,
  uf = null,
  quantidadeResultados = null,
}) {
  try {
    await rpc("hc_registrar_evento_marketplace", {
      p_tipo: tipo,
      p_fisio_id: fisioId,
      p_especialidade: especialidade,
      p_cidade: cidade,
      p_uf: uf,
      p_quantidade_resultados: quantidadeResultados,
      p_sessao_id: sessaoMarketplace(),
    });
  } catch {
    // Analytics nunca pode impedir o paciente de usar o produto.
  }
}

// ---------------------------------------------------------------------------
// Perfil público individual
// ---------------------------------------------------------------------------

export async function obterFisioPublico(fisioId) {
  if (!fisioId) {
    throw new Error("Profissional não informado.");
  }

  const data = await rpc("hc_obter_fisio_publico", { p_fisio_id: fisioId });

  if (!data) {
    throw new Error("Profissional não encontrado.");
  }

  return data;
}

// ---------------------------------------------------------------------------
// Confiança pública — dados usados na landing e nos cards de fisio
// ---------------------------------------------------------------------------

export async function contarFisios() {
  try {
    return await rpc("hc_contar_fisios");
  } catch {
    return null;
  }
}

export async function avaliacoesFisio(fisioId) {
  const data = await rpc("hc_avaliacoes_fisio", { p_fisio_id: fisioId });
  return data || [];
}

export function avaliar({ fisioId, nota, comentario }) {
  return rpc("hc_avaliar", {
    p_fisio_id: fisioId,
    p_nota: nota,
    p_comentario: comentario || null,
  });
}

export function denunciarAvaliacao({ avaliacaoId, motivo, detalhes }) {
  return rpc("hc_denunciar_avaliacao", {
    p_avaliacao_id: avaliacaoId,
    p_motivo: motivo,
    p_detalhes: detalhes || null,
  });
}

// ---------------------------------------------------------------------------
// Autenticação do Painel
// ---------------------------------------------------------------------------

// Bloqueio de força bruta: antes de tentar a senha, confere se esse email já
// levou 5 erros e está nos 15 minutos de bloqueio (ver migration
// 2026-08-07-bloqueio-login). Em caso de erro de credencial, registra a
// falha sem travar a resposta pro usuário; em caso de sucesso, zera a
// contagem. As duas chamadas de contagem não usam await de propósito — não
// podem atrasar o login de quem acertou a senha nem a mensagem de erro de
// quem errou.
export async function entrar(email, senha) {
  const emailNormalizado = email.trim().toLowerCase();
  const db = cliente();

  const bloqueio = await rpc("hc_checar_bloqueio_login", { p_email: emailNormalizado });
  if (bloqueio?.bloqueado) {
    const min = bloqueio.minutos_restantes || 15;
    throw new Error(`Muitas tentativas erradas. Tente de novo em ${min} minuto${min === 1 ? "" : "s"}.`);
  }

  const { data, error } = await db.auth.signInWithPassword({
    email: emailNormalizado,
    password: senha,
  });

  if (error) {
    if (/Invalid login credentials/i.test(error.message || "")) {
      rpc("hc_registrar_falha_login", { p_email: emailNormalizado }).catch(() => {});
    }
    throw error;
  }

  rpc("hc_limpar_tentativas_login").catch(() => {});
  return data.session;
}

export async function sair() {
  await cliente().auth.signOut();
}

// LGPD: apaga/anonimiza todo dado pessoal da conta (cadastro de fisio e/ou
// pedidos feitos como paciente) e agora também apaga o login em si
// (auth.users) — a Edge Function excluir-conta faz as duas coisas usando a
// service role key, que só existe do lado do servidor.
export async function excluirMinhaConta() {
  const { error } = await cliente().functions.invoke("excluir-conta");
  if (error) throw error;
  await cliente().auth.signOut();
}

// O link do email de recuperação volta para a própria página onde a pessoa
// pediu — assim funciona igual para o login de paciente e de fisio, sem
// precisar saber de antemão qual dos dois é.
export async function recuperarSenha(email) {
  const { error } = await cliente().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

export async function definirNovaSenha(novaSenha) {
  const { error } = await cliente().auth.updateUser({ password: novaSenha });
  if (error) throw error;
}

export async function sessaoAtual() {
  if (!supabaseConfigurado) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function aoMudarSessao(callback) {
  if (!supabaseConfigurado) return () => {};
  const { data } = supabase.auth.onAuthStateChange((evento, sessao) => {
    callback(sessao, evento);
  });
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Painel — leitura ampla, só funciona com sessão autenticada
// ---------------------------------------------------------------------------

export async function ehAdmin() {
  const { data, error } = await cliente().rpc("hc_e_admin");
  if (error) throw error;
  return data === true;
}

// Paciente e fisio usam a mesma conta — isso deixa o app travar direto na
// aba certa quando a conta já tem cadastro de fisioterapeuta, em vez de
// deixar a pessoa cair do lado errado.
export async function ehFisio() {
  const { data, error } = await cliente().rpc("hc_sou_fisio");
  if (error) throw error;
  return data === true;
}

export function verificarCrefito({ fisioId, status }) {
  return rpc("hc_verificar_crefito", { p_fisio_id: fisioId, p_status: status });
}

export function salvarPushSubscription({ endpoint, p256dh, auth }) {
  return rpc("hc_salvar_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  });
}

export function removerPushSubscription(endpoint) {
  return rpc("hc_remover_push_subscription", { p_endpoint: endpoint });
}

export async function carregarPainel() {
  const db = cliente();
  const [fisios, pedidos, agendamentos, avaliacoes, mensagens] = await Promise.all([
    db.from("fisios").select("*").order("criado_em", { ascending: false }),
    db.from("pedidos").select("*").order("criado_em", { ascending: false }),
    db.from("agendamentos").select("*").order("criado_em", { ascending: false }),
    db.from("avaliacoes").select("*").order("criado_em", { ascending: false }),
    db.from("mensagens").select("*").order("criado_em", { ascending: true }),
  ]);

  const primeiroErro = [fisios, pedidos, agendamentos, avaliacoes, mensagens].find(
    (r) => r.error
  );
  if (primeiroErro) throw primeiroErro.error;

  return {
    fisios: fisios.data || [],
    pedidos: pedidos.data || [],
    agendamentos: agendamentos.data || [],
    avaliacoes: avaliacoes.data || [],
    mensagens: mensagens.data || [],
  };
}

export function agendar({ pedidoId, fisioId, data, horario }) {
  return rpc("hc_admin_criar_agendamento", {
    p_pedido_id: pedidoId,
    p_fisio_id: fisioId,
    p_data: data,
    p_horario: horario,
  });
}

export function atualizarStatusPedido(id, status) {
  return rpc("hc_admin_atualizar_status_pedido", { p_pedido_id: id, p_status: status });
}

export function atualizarStatusAgendamentoPainel(id, status) {
  return rpc("hc_admin_atualizar_status_agendamento", {
    p_agendamento_id: id,
    p_status: status,
  });
}

// O próprio fisio (fora do Painel do admin) marca um atendimento como
// concluído ou cancelado — hc_marcar_status_agendamento confere que o
// agendamento pertence à conta logada antes de aceitar.
export function marcarStatusAgendamento(id, status) {
  return rpc("hc_marcar_status_agendamento", { p_agendamento_id: id, p_status: status });
}

export function avaliarPeloPainel({ fisioId, nota, comentario, nomeAvaliador }) {
  return rpc("hc_admin_avaliar", {
    p_fisio_id: fisioId,
    p_nota: nota,
    p_comentario: comentario || null,
    p_nome_avaliador: nomeAvaliador || null,
  });
}

// ---------------------------------------------------------------------------
// Moderação de avaliações (admin)
// ---------------------------------------------------------------------------

export async function avaliacoesModeracao() {
  const data = await rpc("hc_avaliacoes_moderacao");
  return data || [];
}

export function moderarAvaliacao({ avaliacaoId, acao }) {
  return rpc("hc_moderar_avaliacao", { p_avaliacao_id: avaliacaoId, p_acao: acao });
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export async function restaurarBackup(dados) {
  const db = cliente();
  // A ordem importa: agendamentos referenciam pedidos e fisios, mensagens
  // referenciam agendamentos.
  const etapas = [
    ["fisios", dados.fisios],
    ["pedidos", dados.pedidos],
    ["agendamentos", dados.agendamentos],
    ["avaliacoes", dados.avaliacoes],
    ["mensagens", dados.mensagens],
  ];

  for (const [tabela, linhas] of etapas) {
    if (!Array.isArray(linhas) || linhas.length === 0) continue;
    // whatsapp_chave é coluna gerada pelo banco e não pode ser gravada.
    const limpas = linhas.map(({ whatsapp_chave, ...resto }) => resto);
    const { error } = await db.from(tabela).upsert(limpas, { onConflict: "id" });
    if (error) throw error;
  }
}
