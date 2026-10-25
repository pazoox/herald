-- Herald — avatares prontos (rodar depois do seguranca.sql; pode rodar de novo sem problema)
--
-- O perfil guarda só QUAL avatar a pessoa escolheu (ex.: "cavaleiro") e a cor do fundo (ex.: "#3a4254").
-- As imagens vêm dentro do app (src/renderer/avatares), então nada de link de fora no banco.

alter table public.profiles add column if not exists avatar text;
alter table public.profiles add column if not exists avatar_cor text;

alter table public.profiles drop constraint if exists profiles_avatar_valido;
alter table public.profiles add constraint profiles_avatar_valido
  check (avatar is null or avatar ~ '^[a-z][a-z-]{0,23}$');

alter table public.profiles drop constraint if exists profiles_avatar_cor_valida;
alter table public.profiles add constraint profiles_avatar_cor_valida
  check (avatar_cor is null or avatar_cor ~ '^#[0-9a-f]{6}$');

select json_build_object(
  'colunas', (select json_agg(column_name) from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name in ('avatar', 'avatar_cor'))
) as resultado;
