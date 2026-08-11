// Contigo Qualidade — mesmos números e a mesma fórmula de
// hc_qualidade_fisio (supabase/migration-2026-08-11-contigo-qualidade.sql).
// Usado no admin (Metricas.jsx), que já busca fisios/avaliacoes crus do
// banco e calcula tudo no cliente — as demais telas (busca, perfil, painel
// do fisio) recebem o nível pronto da própria RPC, não passam por aqui.

export const NIVEIS_QUALIDADE = {
  0: {
    nivel: 0,
    chave: "novo",
    emoji: "",
    label: "Novo no Contigo",
    descricao:
      "Ainda não tem avaliação verificada — não significa nota baixa, só que a rede é recente por aqui.",
  },
  1: {
    nivel: 1,
    chave: "avaliado",
    emoji: "⭐",
    label: "Profissional Avaliado",
    descricao: "Já tem avaliações verificadas de pacientes reais no Contigo.",
  },
  2: {
    nivel: 2,
    chave: "bem_avaliado",
    emoji: "⭐⭐",
    label: "Profissional Bem Avaliado",
    descricao: "Boa nota média em um número consistente de avaliações verificadas.",
  },
  3: {
    nivel: 3,
    chave: "recomendado",
    emoji: "⭐⭐⭐",
    label: "Profissional Recomendado",
    descricao: "Nota alta e mantida em um volume maior de atendimentos avaliados.",
  },
  4: {
    nivel: 4,
    chave: "destaque",
    emoji: "🏆",
    label: "Profissional Destaque",
    descricao:
      "Excelente avaliação de pacientes, histórico consistente, perfil completo e CREFITO verificado pela nossa equipe.",
  },
};

export const TEXTO_SELO_NAO_COMPRAVEL =
  "A avaliação vem de experiências reais de pacientes com atendimento confirmado — este selo não é comprado e nenhum plano pago aumenta o nível.";

// m = peso da média global no cálculo bayesiano; c = nota neutra usada
// quando a plataforma ainda não tem avaliação verificada nenhuma.
const M = 5;
const C_PADRAO = 4.5;

export function calcularNotaAjustada(notaMedia, totalVerificadas, mediaGlobal = C_PADRAO) {
  if (!totalVerificadas) return null;
  const c = mediaGlobal ?? C_PADRAO;
  return (totalVerificadas / (totalVerificadas + M)) * notaMedia + (M / (totalVerificadas + M)) * c;
}

// avaliacoes: linhas cruas da tabela avaliacoes (já filtradas por
// fisio_id). fisio: linha crua de fisios. mediaGlobal: média das
// avaliações verificadas de toda a plataforma (calcule uma vez para todos
// os fisios, não por chamada).
export function calcularNivelQualidade({ avaliacoes, fisio, mediaGlobal }) {
  const verificadas = avaliacoes.filter(
    (a) => a.status === "publicada" && a.agendamento_id != null
  );
  const total = verificadas.length;

  if (total === 0) {
    return { ...NIVEIS_QUALIDADE[0], totalVerificadas: 0, notaAjustada: null };
  }

  const notaMedia = verificadas.reduce((s, a) => s + a.nota, 0) / total;
  const notaAjustada = calcularNotaAjustada(notaMedia, total, mediaGlobal);

  const perfilCompleto = Boolean(
    fisio?.foto_url && fisio?.resumo?.trim() && fisio?.disponibilidade?.trim()
  );
  const crefitoVerificado = fisio?.crefito_status === "verificado";
  const temRemovida = avaliacoes.some((a) => a.status === "removida");

  let nivel = 1;
  if (total >= 8 && notaAjustada >= 4.5) nivel = 2;
  if (total >= 15 && notaAjustada >= 4.7) nivel = 3;
  if (total >= 30 && notaAjustada >= 4.8 && perfilCompleto && crefitoVerificado && !temRemovida) {
    nivel = 4;
  }

  return { ...NIVEIS_QUALIDADE[nivel], totalVerificadas: total, notaAjustada };
}
