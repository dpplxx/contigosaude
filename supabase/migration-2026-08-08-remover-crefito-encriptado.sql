-- Remove as funções de criptografia de CREFITO que tinham a chave fixa no
-- código (versionada no Git). Nenhuma tela do app chama estas duas funções
-- hoje, e elas nem funcionavam de verdade (search_path errado pra achar
-- pgp_sym_encrypt) — então remover é mais seguro do que "consertar" algo
-- que não protegia nenhum dado real. Ver comentário em schema-atual.sql.
drop function if exists public.hc_encriptar_crefito(text);
drop function if exists public.hc_descriptografar_crefito(text);
