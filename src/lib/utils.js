export const ESPECIALIDADES_FISIO = [
  "Ortopédica",
  "Neurológica",
  "Respiratória",
  "Pediátrica",
  "Geriátrica",
  "Pós-cirúrgica",
  "Desportiva",
  "Uroginecológica",
  "Dermatofuncional",
  "Oncológica",
  "Cardiovascular",
  "Reumatológica",
  "Vestibular",
  "Aquática",
  "Do Trabalho / Ergonomia",
  "Intensiva (UTI)",
  "Osteopatia / Terapia Manual",
];

export const ESPECIALIDADES_PACIENTE = [
  ...ESPECIALIDADES_FISIO,
  "Não sei / preciso de orientação",
];

export const URGENCIAS = ["Esta semana", "Próximas semanas", "Só pesquisando"];

export const STATUS_AGENDAMENTO = ["agendado", "concluido", "cancelado"];

export const STATUS_LABEL = {
  agendado: "Agendado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export function onlyDigits(s) {
  return (s || "").replace(/\D/g, "");
}

export function formatarTelefone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

export function telefoneCompleto(value) {
  return onlyDigits(value).length >= 10;
}

export function isNovo(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000;
}

export function formatarMoeda(valor) {
  const num = parseFloat(valor);
  if (valor === null || valor === undefined || valor === "" || isNaN(num)) return "";
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function waLink(phone, text) {
  const digits = onlyDigits(phone);
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text || "")}`;
}

export function formatDataHora(data, horario) {
  if (!data) return "";
  const [ano, mes, dia] = data.split("-");
  const dataFmt = dia && mes ? `${dia}/${mes}/${ano}` : data;
  // O Postgres devolve a hora como HH:MM:SS; na tela basta HH:MM.
  const horaFmt = horario ? horario.slice(0, 5) : "";
  return horaFmt ? `${dataFmt} às ${horaFmt}` : dataFmt;
}

// "data" vem do Postgres como "AAAA-MM-DD" — construir o Date a partir das
// partes (em vez de "new Date(data)") evita o Date interpretar como UTC e
// mostrar o dia anterior em fusos negativos (ex.: Brasil).
export function diasDesdeData(data) {
  if (!data) return 0;
  const [ano, mes, dia] = data.split("-").map(Number);
  const entao = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  entao.setHours(0, 0, 0, 0);
  return Math.floor((hoje - entao) / 86400000);
}

export function dataMaisDias(data, dias) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("pt-BR");
}

export function tempoRelativo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} dia${dias > 1 ? "s" : ""}`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses > 1 ? "meses" : "mês"}`;
}

export function pluralAvaliacoes(n) {
  return n === 1 ? "1 avaliação" : `${n} avaliações`;
}

// Distância em linha reta entre dois pontos, em km. É a mesma fórmula de
// haversine que a função hc_distancia_km usa no banco — aqui serve para o
// Painel, que lê as tabelas direto e calcula na tela.
export function distanciaKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const rad = (g) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function physioCompativelComPedido(p, pedido) {
  const especOk =
    pedido.especialidade === "Não sei / preciso de orientação"
      ? true
      : p.especialidades?.includes(pedido.especialidade);
  if (!especOk) return false;

  // Caminho principal: os dois lados têm coordenada, então vale a distância.
  const dist = distanciaKm(p.lat, p.lng, pedido.lat, pedido.lng);
  if (dist !== null) return dist <= (p.raio_km || 10);

  // Sem coordenada de algum dos lados, cai no critério antigo de texto.
  const cidadeA = (p.cidade || "").toLowerCase();
  const cidadeB = (pedido.cidade || "").toLowerCase();
  const cidadeOk =
    cidadeA && cidadeB && (cidadeA.includes(cidadeB) || cidadeB.includes(cidadeA));
  if (!cidadeOk) return false;

  if (!p.bairros || p.bairros.length === 0) return true;

  const bairroB = (pedido.bairro || "").toLowerCase();
  return p.bairros.some(
    (b) => b.toLowerCase().includes(bairroB) || bairroB.includes(b.toLowerCase())
  );
}

export function calcularMatches(physios, pedido) {
  return physios
    .filter((p) => physioCompativelComPedido(p, pedido))
    .map((p) => ({ ...p, _distancia: distanciaKm(p.lat, p.lng, pedido.lat, pedido.lng) }))
    .sort((a, b) => {
      if (a._distancia === null) return 1;
      if (b._distancia === null) return -1;
      return a._distancia - b._distancia;
    });
}

// Checagem simples de formato, só pra pegar erro de digitação antes de
// bater no servidor — quem valida email de verdade (existe, é entregável)
// é o Supabase Auth ao mandar o email de confirmação.
export function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

// Mínimo 8 caracteres com letra e número — sem exigir símbolo, que só
// atrapalha quem não é técnico sem travar bot nenhum.
export function senhaForte(senha) {
  const s = String(senha || "");
  return s.length >= 8 && /[a-zA-Z]/.test(s) && /[0-9]/.test(s);
}

// Checagem de formato do número de registro no CREFITO (não confirma se o
// registro existe de verdade — isso continua sendo a verificação manual do
// admin no Painel). Aceita só os dígitos ("123456") ou com o sufixo de
// categoria ("123456-F", "123456-TO"), que é como o CREFITO formata na
// prática. 3 a 7 dígitos cobre tanto matrícula antiga curta quanto região
// nova com volume alto.
export function crefitoValido(crefito) {
  const c = String(crefito || "").trim().toUpperCase();
  return /^\d{3,7}(-[A-Z]{1,3})?$/.test(c);
}

// Link de busca (não uma consulta oficial): o CREFITO não tem conselho
// único nem API — são ~19 regionais, cada um com seu próprio site, e esse
// mapeamento está mudando (Goiás virou CREFITO-19 em 2024, Paraíba vira
// CREFITO-21 em breve). Em vez de cravar um mapeamento UF→site que
// envelhece mal, deixa o Google achar o site regional certo.
export function linkBuscaCrefito(crefito, uf) {
  const termo = `CREFITO consulta ${crefito || ""} ${uf || ""} fisioterapeuta`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(termo)}`;
}

// Mensagem de erro legível. O Postgres devolve o texto do RAISE EXCEPTION em
// .message, então as validações do banco chegam prontas para o usuário.
export function mensagemDeErro(erro, padrao) {
  const bruta = erro?.message || "";
  if (!bruta) return padrao;
  if (/fetch|network|failed to fetch/i.test(bruta)) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  }
  if (/JWT|apikey|Invalid API key/i.test(bruta)) {
    return "O app está sem as chaves de acesso ao banco. Avise o responsável.";
  }
  return bruta;
}
