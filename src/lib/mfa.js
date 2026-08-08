import { supabase } from "./supabase";

// Wrapper fino em cima de supabase.auth.mfa.* — nada aqui fala com o banco
// direto, é tudo API do próprio Supabase Auth (GoTrue).

export async function statusMfa() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return {
    // "ativo" = a conta tem ao menos um fator verificado (independente da
    // sessão atual já ter completado o desafio ou não).
    ativo: data.nextLevel === "aal2",
    // "precisaDesafio" = a conta tem fator, mas ESTA sessão ainda está em
    // aal1 — precisa do código antes de liberar dado sensível.
    precisaDesafio: data.nextLevel === "aal2" && data.currentLevel !== "aal2",
  };
}

export async function listarFatores() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp || [];
}

export async function iniciarEnrolamento() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  return data;
}

export async function confirmarEnrolamento({ factorId, codigo }) {
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: codigo,
  });
  if (error) throw error;
  return data;
}

export async function desafiarLogin({ factorId, codigo }) {
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: codigo,
  });
  if (error) throw error;
  return data;
}

export async function desativarFator(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
