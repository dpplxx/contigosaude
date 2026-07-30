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

export function criarPedido(form) {
  return rpc("fec_criar_pedido", {
    p_nome: form.nome,
    p_whatsapp: form.whatsapp,
    p_especialidade: form.especialidade,
    p_cidade: form.cidade,
    p_bairro: form.bairro,
    p_urgencia: form.urgencia,
    p_observacoes: form.observacoes || null,
    p_cep: form.cep || null,
    p_uf: form.uf || null,
    p_lat: form.lat ?? null,
    p_lng: form.lng ?? null,
  });
}

export function cadastrarFisio(form) {
  const valor = parseFloat(String(form.valorSessao).replace(",", "."));
  return rpc("fec_cadastrar_fisio", {
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
  });
}

// ---------------------------------------------------------------------------
// Áreas identificadas pelo WhatsApp
// ---------------------------------------------------------------------------

export async function meusPedidos(whatsapp) {
  const data = await rpc("fec_meus_pedidos", { p_whatsapp: whatsapp });
  return data || [];
}

export async function painelFisio(whatsapp) {
  const data = await rpc("fec_painel_fisio", { p_whatsapp: whatsapp });
  return data || { fisio: null };
}

export function enviarMensagem({ agendamentoId, whatsapp, remetente, remetenteNome, texto }) {
  return rpc("fec_enviar_mensagem", {
    p_agendamento_id: agendamentoId,
    p_whatsapp: whatsapp,
    p_remetente: remetente,
    p_remetente_nome: remetenteNome,
    p_texto: texto,
  });
}

export function marcarStatusAgendamento({ agendamentoId, status, whatsapp }) {
  return rpc("fec_marcar_status_agendamento", {
    p_agendamento_id: agendamentoId,
    p_status: status,
    p_whatsapp: whatsapp,
  });
}

export function avaliar({ fisioId, nota, comentario, whatsapp }) {
  return rpc("fec_avaliar", {
    p_fisio_id: fisioId,
    p_nota: nota,
    p_comentario: comentario || null,
    p_whatsapp: whatsapp,
  });
}

export async function registrarClique(fisioId) {
  try {
    await rpc("fec_registrar_clique", { p_fisio_id: fisioId });
  } catch {
    // O contador é só métrica: se falhar, não vale travar o clique do usuário.
  }
}

// ---------------------------------------------------------------------------
// Autenticação do Painel
// ---------------------------------------------------------------------------

export async function entrar(email, senha) {
  const { data, error } = await cliente().auth.signInWithPassword({
    email: email.trim(),
    password: senha,
  });
  if (error) throw error;
  return data.session;
}

export async function sair() {
  await cliente().auth.signOut();
}

export async function sessaoAtual() {
  if (!supabaseConfigurado) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function aoMudarSessao(callback) {
  if (!supabaseConfigurado) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
    callback(sessao);
  });
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Painel — leitura ampla, só funciona com sessão autenticada
// ---------------------------------------------------------------------------

export async function ehAdmin() {
  const { data, error } = await cliente().rpc("fec_e_admin");
  if (error) throw error;
  return data === true;
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

export async function agendar({ pedidoId, fisioId, data, horario }) {
  const { error } = await cliente()
    .from("agendamentos")
    .insert({ pedido_id: pedidoId, fisio_id: fisioId, data, horario });
  if (error) throw error;
}

export async function atualizarStatusPedido(id, status) {
  const { error } = await cliente().from("pedidos").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function atualizarStatusAgendamentoPainel(id, status) {
  const { error } = await cliente().from("agendamentos").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function avaliarPeloPainel({ fisioId, nota, comentario }) {
  const { error } = await cliente()
    .from("avaliacoes")
    .insert({ fisio_id: fisioId, nota, comentario: comentario || null });
  if (error) throw error;
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
