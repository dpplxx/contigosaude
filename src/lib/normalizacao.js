/**
 * Normalização de dados geolocaliza dos
 * Reduz problemas causados por erros de digitação, acentuação, etc.
 *
 * Exemplo de uso:
 * - "Tatuapé" combina com "Tatuape"
 * - "São Paulo" combina com "Sao Paulo"
 * - Tolerância: até 85% de similaridade
 */

// Mapa de acentos comuns → sem acento
const ACENTOS = {
  'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c',
  'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
  'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
  'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
  'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
  'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
  'Ç': 'C',
};

/**
 * Remove acentos, espaços extras, normaliza maiúsculas
 */
export function normalizarTexto(texto) {
  if (!texto) return '';

  return texto
    .split('')
    .map(char => ACENTOS[char] || char)
    .join('')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Remove espaços múltiplos
}

/**
 * Calcula similaridade entre duas strings (0-1)
 * Usa algoritmo de Levenshtein para permitir pequenos erros de digitação
 */
export function calcularSimilaridade(str1, str2) {
  const a = normalizarTexto(str1);
  const b = normalizarTexto(str2);

  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Matriz de distância
  const matriz = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matriz[0][i] = i;
  for (let j = 0; j <= b.length; j++) matriz[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[j][i] = Math.min(
        matriz[j][i - 1] + 1,      // deleção
        matriz[j - 1][i] + 1,      // inserção
        matriz[j - 1][i - 1] + custo // substituição
      );
    }
  }

  const distancia = matriz[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);

  // Retorna 1 - (distancia / maxLen)
  return 1 - (distancia / maxLen);
}

/**
 * Verifica se dois bairros podem ser considerados "iguais"
 * Tolera pequenos erros de digitação
 */
export function bairrosCompatíveis(bairro1, bairro2, limiar = 0.85) {
  return calcularSimilaridade(bairro1, bairro2) >= limiar;
}

/**
 * Verifica se duas cidades podem ser consideradas "iguais"
 * Mais rigoroso que bairro (menos flexível)
 */
export function cidadesCompatíveis(cidade1, cidade2, limiar = 0.90) {
  return calcularSimilaridade(cidade1, cidade2) >= limiar;
}

/**
 * Normaliza CEP (remove caracteres não numéricos)
 */
export function normalizarCEP(cep) {
  return (cep || '').replace(/\D/g, '').slice(0, 8);
}

/**
 * Valida CEP brasileiro (formato básico)
 */
export function ehCepValido(cep) {
  const normalizado = normalizarCEP(cep);
  return normalizado.length === 8 && /^\d{5}\d{3}$/.test(normalizado);
}

/**
 * Exemplo de uso:
 *
 * calcularSimilaridade('Tatuapé', 'Tatuape')      → 0.89 (compatível)
 * calcularSimilaridade('São Paulo', 'Sao Paulo') → 0.93 (compatível)
 * bairrosCompatíveis('Tatuapé', 'Tatuape')       → true
 * cidadesCompatíveis('São Paulo', 'Sao Paulo')   → true
 */
