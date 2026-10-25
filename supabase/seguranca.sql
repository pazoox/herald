-- Herald — segurança (rodar depois do schema.sql e do cargos.sql; pode rodar de novo sem problema)
--
--   1. Quem sai ou é expulso de um Nest perde o acesso às calls (a senha dos canais de voz muda)
--   2. Cargo CEO: vale pro Herald inteiro, acima de qualquer owner
--   3. Cadastro fechado: só cria conta quem tiver o código do dia (só CEO vê o código)
--   4. Nomes únicos no Herald inteiro (ignorando maiúsculas, espaços e acentos)
--   5. Cada um só vê o perfil de quem divide um Nest com ele
--   6. Sem fotos enviadas por enquanto (vão virar avatares prontos)

create extension if not exists pgcrypto;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- 1. senha nova nas calls

create or replace function public.trocar_chaves_de_voz()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from nests where id = old.nest_id) then
    update channels set voice_key = encode(gen_random_bytes(16), 'hex')
      where nest_id = old.nest_id and kind = 'voice';
  end if;
  return null;
end;
$$;

drop trigger if exists nest_members_trocar_chaves on public.nest_members;
create trigger nest_members_trocar_chaves after delete on public.nest_members
  for each row execute function public.trocar_chaves_de_voz();

-- ---------------------------------------------------------------- 2. CEO

create table if not exists public.herald_ceos (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.herald_ceos enable row level security; -- sem regras: ninguém lê nem escreve pelo app

create or replace function public.is_ceo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from herald_ceos where user_id = auth.uid());
$$;

-- o primeiro CEO é o criador do Herald
insert into public.herald_ceos (user_id)
  select id from auth.users where email = 'pazin1999@gmail.com'
  on conflict do nothing;

-- ---------------------------------------------------------------- 3. código do dia

-- segredo que gera os códigos: fica só no banco, nenhum app consegue ler
create table if not exists public.herald_segredo (
  id int primary key default 1 check (id = 1),
  segredo bytea not null default extensions.gen_random_bytes(32)
);
alter table public.herald_segredo enable row level security;
revoke all on public.herald_segredo from anon, authenticated;
insert into public.herald_segredo (id) values (1) on conflict do nothing;

-- dia de hoje no horário de Brasília
create or replace function public.herald_hoje()
returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- 8 letras/números, sem os que confundem (0/O, 1/I/L)
create or replace function public.codigo_de(dia date)
returns text language sql stable security definer set search_path = public, extensions as $$
  select substr(translate(upper(encode(hmac(convert_to(dia::text, 'utf8'), (select segredo from herald_segredo), 'sha256'), 'base64')), '+/=0O1IL', ''), 1, 8);
$$;
revoke execute on function public.codigo_de(date) from public, anon, authenticated;

-- só CEO vê o código de hoje (e quando ele muda)
create or replace function public.codigo_do_dia()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ceo() then raise exception 'not allowed'; end if;
  return json_build_object(
    'codigo', codigo_de(herald_hoje()),
    'muda_em', ((herald_hoje() + 1)::timestamp at time zone 'America/Sao_Paulo')
  );
end;
$$;
revoke execute on function public.codigo_do_dia() from public, anon;
grant execute on function public.codigo_do_dia() to authenticated;

-- usado só pela função do servidor que cria contas
create or replace function public.codigo_valido(c text)
returns boolean language sql stable security definer set search_path = public as $$
  select upper(trim(coalesce(c, ''))) = codigo_de(herald_hoje());
$$;
revoke execute on function public.codigo_valido(text) from public, anon, authenticated;
grant execute on function public.codigo_valido(text) to service_role;

-- trava no próprio banco: conta só nasce com o código do dia junto.
-- (O serviço de login grava o app_metadata DEPOIS de inserir a conta, então a trava confere o
--  user_metadata, que já chega na inserção: a função do servidor manda o código em "herald_codigo".)
create or replace function public.so_contas_liberadas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'herald_ok', '') <> 'true'
     and not codigo_valido(new.raw_user_meta_data ->> 'herald_codigo') then
    raise exception 'sign-ups are closed';
  end if;
  return new;
end;
$$;

drop trigger if exists herald_so_contas_liberadas on auth.users;
create trigger herald_so_contas_liberadas before insert on auth.users
  for each row execute function public.so_contas_liberadas();

-- ---------------------------------------------------------------- 4. nomes únicos

create or replace function public.nome_chave(n text)
returns text language sql immutable set search_path = public, extensions as $$
  select lower(regexp_replace(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(n, '')), '\s', '', 'g'));
$$;

create unique index if not exists profiles_nome_unico on public.profiles (public.nome_chave(display_name));

create or replace function public.nome_disponivel(n text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where nome_chave(display_name) = nome_chave(n) and id is distinct from auth.uid());
$$;
grant execute on function public.nome_disponivel(text) to authenticated, service_role;

-- ---------------------------------------------------------------- 5. perfis só de quem divide Nest

create or replace function public.divide_nest(u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid() or exists (
    select 1 from nest_members a join nest_members b on a.nest_id = b.nest_id
    where a.user_id = auth.uid() and b.user_id = u
  );
$$;

drop policy if exists "profiles: ver" on public.profiles;
create policy "profiles: ver" on public.profiles for select to authenticated using (divide_nest(id));

-- ---------------------------------------------------------------- 6. sem fotos enviadas

update public.profiles set avatar_url = null where avatar_url is not null;
update public.nests set icon_url = null where icon_url is not null;

alter table public.profiles drop constraint if exists profiles_sem_foto;
alter table public.profiles add constraint profiles_sem_foto check (avatar_url is null);
alter table public.nests drop constraint if exists nests_sem_icone;
alter table public.nests add constraint nests_sem_icone check (icon_url is null);

drop policy if exists "avatars: enviar a sua" on storage.objects;
drop policy if exists "avatars: trocar a sua" on storage.objects;
drop policy if exists "avatars: icone do nest" on storage.objects;
drop policy if exists "avatars: trocar icone do nest" on storage.objects;
update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id = 'avatars';

-- conferência
select json_build_object(
  'ceos', (select count(*) from public.herald_ceos),
  'nomes_unicos', (select count(*) from pg_indexes where indexname = 'profiles_nome_unico')
) as resultado;
