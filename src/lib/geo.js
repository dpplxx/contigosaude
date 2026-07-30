// Consulta de CEP e geocodificação.
//
// Nenhum serviço aqui pede chave de API, cadastro ou cartão. A conta é feita
// uma vez, no momento em que a pessoa preenche o formulário, e as coordenadas
// ficam salvas no banco — então o custo por consulta de distância é zero.
//
// A cadeia é: BrasilAPI (endereço + coordenadas) → ViaCEP (só endereço, mas
// muito confiável) → Nominatim/OpenStreetMap (coordenadas a partir do
// endereço). Se tudo falhar, o formulário continua funcionando com a pessoa
// digitando cidade e bairro na mão, e o match cai no critério de texto.

const TIMEOUT_MS = 6000;

async function buscarComTimeout(url, opcoes = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return await resposta.json();
  } finally {
    clearTimeout(timer);
  }
}

export function limparCep(cep) {
  return (cep || "").replace(/\D/g, "").slice(0, 8);
}

export function formatarCep(cep) {
  const d = limparCep(cep);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function cepCompleto(cep) {
  return limparCep(cep).length === 8;
}

function numeroValido(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && !isNaN(n) ? n : null;
}

async function viaBrasilApi(cep) {
  const dados = await buscarComTimeout(`https://brasilapi.com.br/api/cep/v2/${cep}`);
  const coords = dados?.location?.coordinates || {};
  return {
    logradouro: dados.street || "",
    bairro: dados.neighborhood || "",
    cidade: dados.city || "",
    uf: dados.state || "",
    lat: numeroValido(coords.latitude),
    lng: numeroValido(coords.longitude),
  };
}

async function viaCep(cep) {
  const dados = await buscarComTimeout(`https://viacep.com.br/ws/${cep}/json/`);
  if (dados.erro) throw new Error("CEP não encontrado");
  return {
    logradouro: dados.logradouro || "",
    bairro: dados.bairro || "",
    cidade: dados.localidade || "",
    uf: dados.uf || "",
    lat: null,
    lng: null,
  };
}

// Último recurso para as coordenadas: procura o endereço no OpenStreetMap.
// Vai do mais específico para o mais genérico, porque nem todo bairro está
// mapeado, mas cidade sempre está.
async function coordenadasPorEndereco({ logradouro, bairro, cidade, uf }) {
  const tentativas = [
    [logradouro, bairro, cidade, uf],
    [bairro, cidade, uf],
    [cidade, uf],
  ];

  for (const partes of tentativas) {
    const consulta = partes.filter(Boolean).join(", ");
    if (!consulta) continue;
    try {
      const url =
        "https://nominatim.openstreetmap.org/search" +
        `?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(consulta + ", Brasil")}`;
      const resultado = await buscarComTimeout(url, {
        headers: { Accept: "application/json" },
      });
      if (Array.isArray(resultado) && resultado.length > 0) {
        const lat = numeroValido(resultado[0].lat);
        const lng = numeroValido(resultado[0].lon);
        if (lat !== null && lng !== null) return { lat, lng };
      }
    } catch {
      // Tenta a próxima combinação, menos específica.
    }
  }

  return { lat: null, lng: null };
}

/**
 * Recebe um CEP em qualquer formato e devolve o endereço com coordenadas.
 * Lança erro só quando não conseguiu nem o endereço — nesse caso o formulário
 * pede para a pessoa digitar cidade e bairro na mão.
 */
export async function consultarCep(cepBruto) {
  const cep = limparCep(cepBruto);
  if (cep.length !== 8) throw new Error("CEP incompleto.");

  let endereco;
  try {
    endereco = await viaBrasilApi(cep);
  } catch {
    endereco = await viaCep(cep);
  }

  if (!endereco.cidade) throw new Error("CEP não encontrado.");

  if (endereco.lat === null || endereco.lng === null) {
    const coords = await coordenadasPorEndereco(endereco);
    endereco.lat = coords.lat;
    endereco.lng = coords.lng;
  }

  // Devolve o CEP já com máscara: é esse valor que volta para o campo na tela.
  // O banco limpa a pontuação sozinho na hora de gravar.
  return { cep: formatarCep(cep), ...endereco };
}

export function formatarDistancia(km) {
  if (km === null || km === undefined) return "";
  const n = typeof km === "string" ? parseFloat(km) : km;
  if (isNaN(n)) return "";
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1).replace(".", ",")} km`;
}
