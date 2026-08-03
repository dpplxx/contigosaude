import { describe, it, expect } from "vitest";
import {
  normalizarTexto,
  calcularSimilaridade,
  bairrosCompatíveis,
  cidadesCompatíveis,
  normalizarCEP,
  ehCepValido,
} from "./normalizacao";

describe("normalizarTexto", () => {
  it("remove acentos e baixa a caixa", () => {
    expect(normalizarTexto("Tatuapé")).toBe("tatuape");
    expect(normalizarTexto("São Paulo")).toBe("sao paulo");
  });

  it("colapsa espaços múltiplos e tira das bordas", () => {
    expect(normalizarTexto("  Vila   Velha  ")).toBe("vila velha");
  });

  it("retorna vazio para entrada vazia", () => {
    expect(normalizarTexto("")).toBe("");
    expect(normalizarTexto(null)).toBe("");
  });
});

describe("calcularSimilaridade", () => {
  it("retorna 1 para strings idênticas após normalizar", () => {
    expect(calcularSimilaridade("Tatuapé", "tatuape")).toBe(1);
  });

  it("retorna 0 se uma das strings for vazia", () => {
    expect(calcularSimilaridade("", "Serra")).toBe(0);
    expect(calcularSimilaridade("Serra", "")).toBe(0);
  });

  it("tolera pequeno erro de digitação com nota alta", () => {
    const nota = calcularSimilaridade("Tatuapé", "Tatuape");
    expect(nota).toBeGreaterThan(0.8);
  });

  it("dá nota baixa pra strings bem diferentes", () => {
    const nota = calcularSimilaridade("Serra", "Vitória");
    expect(nota).toBeLessThan(0.5);
  });
});

describe("bairrosCompatíveis", () => {
  it('aceita "Tatuapé" e "Tatuape" como o mesmo bairro', () => {
    expect(bairrosCompatíveis("Tatuapé", "Tatuape")).toBe(true);
  });

  it("recusa bairros claramente diferentes", () => {
    expect(bairrosCompatíveis("Tatuapé", "Centro")).toBe(false);
  });
});

describe("cidadesCompatíveis", () => {
  it('aceita "São Paulo" e "Sao Paulo" como a mesma cidade', () => {
    expect(cidadesCompatíveis("São Paulo", "Sao Paulo")).toBe(true);
  });

  it("é mais rigoroso que bairro (limiar maior)", () => {
    // Uma diferença de uma letra em nome curto pesa mais no limiar de cidade.
    expect(cidadesCompatíveis("Serra", "Serrra")).toBe(
      calcularSimilaridade("Serra", "Serrra") >= 0.9
    );
  });
});

describe("normalizarCEP", () => {
  it("remove tudo que não é dígito e trunca em 8", () => {
    expect(normalizarCEP("29160-000")).toBe("29160000");
    expect(normalizarCEP("29160000extra")).toBe("29160000");
  });

  it("lida com entrada vazia", () => {
    expect(normalizarCEP("")).toBe("");
    expect(normalizarCEP(null)).toBe("");
  });
});

describe("ehCepValido", () => {
  it("aceita CEP com 8 dígitos", () => {
    expect(ehCepValido("29160-000")).toBe(true);
    expect(ehCepValido("29160000")).toBe(true);
  });

  it("recusa CEP incompleto", () => {
    expect(ehCepValido("29160")).toBe(false);
    expect(ehCepValido("")).toBe(false);
  });
});
