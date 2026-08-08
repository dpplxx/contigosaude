-- RBAC: fecha uma permissão sobrando encontrada na auditoria de 08/08 —
-- hc_encriptar_crefito estava liberada pra "anon" (qualquer visitante, sem
-- login nenhum) e hc_descriptografar_crefito estava liberada pra qualquer
-- conta autenticada (paciente ou fisio, não só admin). Nenhuma tela do app
-- chama essas duas funções hoje — a verificação de CREFITO que existe de
-- verdade é manual, pelo admin, via hc_verificar_crefito (migration-2026-
-- 08-02-verificar-crefito.sql). Ficaram como sobra de uma criptografia que
-- nunca foi ligada (ver comentário original em schema.sql), mas continuam
-- ativas no banco — então qualquer visitante conseguia chamar uma função
-- de criptografia do app usando a chave fixa do código, sem motivo nenhum
-- pra isso ser público.
--
-- Não muda nada pra ninguém que já usa o app (nada chama essas funções),
-- só fecha o acesso: só admin pode encriptar/descriptografar CREFITO a
-- partir de agora.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.

create or replace function public.hc_encriptar_crefito(p_crefito text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  return pgp_sym_encrypt(p_crefito, 'chave-segura-fisio-em-casa-2026');
end $$;

revoke all on function public.hc_encriptar_crefito(text) from public, anon, authenticated;
grant execute on function public.hc_encriptar_crefito(text) to authenticated;

create or replace function public.hc_descriptografar_crefito(p_encrypted text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  return pgp_sym_decrypt(p_encrypted::bytea, 'chave-segura-fisio-em-casa-2026');
end $$;

revoke all on function public.hc_descriptografar_crefito(text) from public, anon, authenticated;
grant execute on function public.hc_descriptografar_crefito(text) to authenticated;
