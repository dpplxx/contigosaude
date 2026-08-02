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
  return rpc("hc_criar_pedido", {
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

// ---------------------------------------------------------------------------
// Área do paciente — usa a conta logada, não mais o WhatsApp digitado.
// Veja migration-paciente-auth.sql.
// ---------------------------------------------------------------------------

export async function meusPedidos() {
  const data = await rpc("hc_meus_pedidos");
  return data || [];
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

export function enviarMensagem({ agendamentoId, remetente, remetenteNome, texto }) {
  return rpc("hc_enviar_mensagem", {
    p_agendamento_id: agendamentoId,
    p_remetente: remetente,
    p_remetente_nome: remetenteNome,
    p_texto: texto,
  });
}

export function marcarStatusAgendamento({ agendamentoId, status }) {
  return rpc("hc_marcar_status_agendamento", {
    p_agendamento_id: agendamentoId,
    p_status: status,
  });
}

// O fisio fecha um atendimento sozinho, a partir de um pedido compatível
// que ele já está vendo no painel — sem precisar de ninguém confirmando
// por fora. Devolve o nome e o WhatsApp do paciente, liberados só agora
// que o fisio assumiu o atendimento.
export function fecharAgendamento({ pedidoId, data, horario }) {
  return rpc("hc_fechar_agendamento", {
    p_pedido_id: pedidoId,
    p_data: data,
    p_horario: horario,
  });
}

export function avaliar({ fisioId, nota, comentario }) {
  return rpc("hc_avaliar", {
    p_fisio_id: fisioId,
    p_nota: nota,
    p_comentario: comentario || null,
  });
}

export async function registrarClique(fisioId) {
  try {
    await rpc("hc_registrar_clique", { p_fisio_id: fisioId });
  } catch {
    // O contador é só métrica: se falhar, não vale travar o clique do usuário.
  }
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
