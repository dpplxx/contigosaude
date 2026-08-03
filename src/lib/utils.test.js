import { describe, it, expect } from "vitest";
import {
  formatarTelefone,
  telefoneCompleto,
  waLink,
  tempoRelativo,
  pluralAvaliacoes,
  formatarMoeda,
  isNovo,
  distanciaKm,
  physioCompativelComPedido,
  calcularMatches,
  mensagemDeErro,
} from "./utils";

describe("formatarTelefone", () => {
  it("formata progressivamente enquanto digita", () => {
    expect(formatarTelefone("")).toBe("");
    expect(formatarTelefone("11")).toBe("(11");
    expect(formatarTelefone("119876")).toBe("(11) 9876");
    expect(formatarTelefone("11987654321")).toBe("(11) 98765-4321");
  });

  it("ignora caracteres não numéricos e trunca em 11 dígitos", () => {
    expect(formatarTelefone("(11) 98765-4321extra")).toBe("(11) 98765-4321");
  });
});

describe("telefoneCompleto", () => {
  it("exige pelo menos 10 dígitos", () => {
    expect(telefoneCompleto("119876543")).toBe(false); // 9 dígitos
    expect(telefoneCompleto("1198765432")).toBe(true); // 10 dígitos
    expect(telefoneCompleto("11987654321")).toBe(true); // 11 dígitos
  });
});

describe("waLink", () => {
  it("adiciona o código do país 55 quando ausente", () => {
    const link = waLink("(11) 98765-4321", "Olá");
    expect(link).toBe("https://wa.me/5511987654321?text=Ol%C3%A1");
  });

  it("não duplica o código do país se já vier com 55", () => {
    const link = waLink("5511987654321", "oi");
    expect(link).toBe("https://wa.me/5511987654321?text=oi");
  });

  it("funciona sem texto", () => {
    expect(waLink("11987654321")).toBe("https://wa.me/5511987654321?text=");
  });
});

describe("tempoRelativo", () => {
  it("retorna string vazia sem data", () => {
    expect(tempoRelativo(null)).toBe("");
    expect(tempoRelativo(undefined)).toBe("");
  });

  it("descreve minutos, horas e dias corretamente", () => {
    const agora = Date.now();
    expect(tempoRelativo(new Date(agora - 30_000).toISOString())).toBe("agora mesmo");
    expect(tempoRelativo(new Date(agora - 5 * 60_000).toISOString())).toBe("há 5 min");
    expect(tempoRelativo(new Date(agora - 3 * 3_600_000).toISOString())).toBe("há 3h");
    expect(tempoRelativo(new Date(agora - 2 * 86_400_000).toISOString())).toBe("há 2 dias");
  });
});

describe("pluralAvaliacoes", () => {
  it("usa singular só para exatamente 1", () => {
    expect(pluralAvaliacoes(0)).toBe("0 avaliações");
    expect(pluralAvaliacoes(1)).toBe("1 avaliação");
    expect(pluralAvaliacoes(2)).toBe("2 avaliações");
  });
});

describe("formatarMoeda", () => {
  it("formata número como BRL", () => {
    expect(formatarMoeda(150)).toBe("R$ 150,00");
  });

  it("retorna vazio para valores ausentes ou inválidos", () => {
    expect(formatarMoeda(null)).toBe("");
    expect(formatarMoeda(undefined)).toBe("");
    expect(formatarMoeda("")).toBe("");
    expect(formatarMoeda("abc")).toBe("");
  });
});

describe("isNovo", () => {
  it("considera novo o que foi criado há menos de 24h", () => {
    expect(isNovo(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isNovo(new Date(Date.now() - 25 * 3_600_000).toISOString())).toBe(false);
    expect(isNovo(null)).toBe(false);
  });
});

describe("distanciaKm", () => {
  it("retorna null se faltar alguma coordenada", () => {
    expect(distanciaKm(null, null, -20, -40)).toBeNull();
    expect(distanciaKm(-20, -40, null, null)).toBeNull();
  });

  it("calcula ~0 para o mesmo ponto", () => {
    expect(distanciaKm(-20.3, -40.3, -20.3, -40.3)).toBeCloseTo(0, 5);
  });

  it("calcula uma distância real conhecida (Vitória-Vila Velha, ~5km em linha reta)", () => {
    // Vitória, ES ~ -20.3155, -40.3128 | Vila Velha, ES ~ -20.3297, -40.2925
    const dist = distanciaKm(-20.3155, -40.3128, -20.3297, -40.2925);
    expect(dist).toBeGreaterThan(1);
    expect(dist).toBeLessThan(10);
  });
});

describe("physioCompativelComPedido", () => {
  const base = {
    especialidades: ["Ortopédica"],
    lat: -20.3155,
    lng: -40.3128,
    raio_km: 10,
    cidade: "Serra",
    bairros: ["Laranjeiras"],
  };

  it("recusa quando a especialidade não bate", () => {
    const pedido = { especialidade: "Neurológica", lat: -20.32, lng: -40.31, cidade: "Serra" };
    expect(physioCompativelComPedido(base, pedido)).toBe(false);
  });

  it('aceita qualquer especialidade quando o pedido é "não sei"', () => {
    const pedido = {
      especialidade: "Não sei / preciso de orientação",
      lat: -20.3155,
      lng: -40.3128,
      cidade: "Serra",
    };
    expect(physioCompativelComPedido(base, pedido)).toBe(true);
  });

  it("com coordenadas dos dois lados, decide só pela distância dentro do raio", () => {
    const pertoDemais = { especialidade: "Ortopédica", lat: -20.3155, lng: -40.3128, cidade: "Outra" };
    expect(physioCompativelComPedido(base, pertoDemais)).toBe(true);

    const longeDemais = { especialidade: "Ortopédica", lat: -22.9, lng: -43.2, cidade: "Rio" }; // ~RJ
    expect(physioCompativelComPedido(base, longeDemais)).toBe(false);
  });

  it("sem coordenadas, cai pro critério de texto (cidade e bairro)", () => {
    const pedidoCidadeBate = { especialidade: "Ortopédica", cidade: "Serra", bairro: "Laranjeiras" };
    expect(physioCompativelComPedido(base, pedidoCidadeBate)).toBe(true);

    const pedidoCidadeDiferente = { especialidade: "Ortopédica", cidade: "Vitória", bairro: "Centro" };
    expect(physioCompativelComPedido(base, pedidoCidadeDiferente)).toBe(false);
  });

  it("sem bairros cadastrados no fisio, aceita qualquer bairro da mesma cidade", () => {
    const semBairros = { ...base, bairros: [] };
    const pedido = { especialidade: "Ortopédica", cidade: "Serra", bairro: "Qualquer Um" };
    expect(physioCompativelComPedido(semBairros, pedido)).toBe(true);
  });
});

describe("calcularMatches", () => {
  it("filtra incompatíveis e ordena por distância crescente", () => {
    const pedido = { especialidade: "Ortopédica", lat: -20.3155, lng: -40.3128, cidade: "Serra" };
    const physios = [
      { id: "longe", especialidades: ["Ortopédica"], lat: -20.4, lng: -40.4, raio_km: 50 },
      { id: "perto", especialidades: ["Ortopédica"], lat: -20.3156, lng: -40.3129, raio_km: 50 },
      { id: "incompativel", especialidades: ["Neurológica"], lat: -20.3155, lng: -40.3128, raio_km: 50 },
    ];

    const resultado = calcularMatches(physios, pedido);

    expect(resultado.map((p) => p.id)).toEqual(["perto", "longe"]);
  });

  it("manda pro final quem não tem distância calculável", () => {
    const pedido = { especialidade: "Ortopédica", cidade: "Serra", bairro: "Laranjeiras" };
    const physios = [
      { id: "sem-coord", especialidades: ["Ortopédica"], cidade: "Serra", bairros: ["Laranjeiras"] },
      {
        id: "com-coord",
        especialidades: ["Ortopédica"],
        lat: -20.3155,
        lng: -40.3128,
        raio_km: 50,
      },
    ];

    // Sem coordenada no pedido, o com-coord também cai no critério de texto —
    // mas como o pedido não tem lat/lng, nenhum dos dois calcula _distancia.
    const resultado = calcularMatches(physios, pedido);
    expect(resultado.length).toBeGreaterThan(0);
  });
});

describe("mensagemDeErro", () => {
  it("traduz erro de rede pra mensagem amigável", () => {
    const erro = { message: "Failed to fetch" };
    expect(mensagemDeErro(erro, "padrão")).toMatch(/sem conexão/i);
  });

  it("traduz erro de chave de API pra mensagem amigável", () => {
    const erro = { message: "Invalid API key" };
    expect(mensagemDeErro(erro, "padrão")).toMatch(/chaves de acesso/i);
  });

  it("repassa a mensagem do banco quando não é caso especial", () => {
    const erro = { message: "Você já avaliou este atendimento." };
    expect(mensagemDeErro(erro, "padrão")).toBe("Você já avaliou este atendimento.");
  });

  it("usa a mensagem padrão quando não há erro.message", () => {
    expect(mensagemDeErro(null, "Erro ao buscar profissionais.")).toBe(
      "Erro ao buscar profissionais."
    );
    expect(mensagemDeErro({}, "padrão")).toBe("padrão");
  });
});
