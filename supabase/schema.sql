-- Herald — banco de dados (Supabase / Postgres)
-- Cole tudo no SQL Editor do Supabase e clique em "Run". Pode rodar de novo sem problema.
--
-- Tabelas:
--   profiles      nome e foto de cada conta
--   nests         os "servidores" (Nests)
--   nest_members  quem está em cada Nest
--   channels      canais de texto e de voz de cada Nest
--   messages      mensagens dos canais de texto
--
-- Ninguém lê nada de um Nest sem ser membro (Row Level Security).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tabelas

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.nests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  icon_url text,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique default lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  created_at timestamptz not null default now()
);

create table if not exists public.nest_members (
  nest_id uuid not null references public.nests (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (nest_id, user_id)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  nest_id uuid not null references public.nests (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  kind text not null check (kind in ('text', 'voice')),
  position int not null default 0,
  -- segredo da sala de voz P2P: só membros conseguem ler
  voice_key text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  nest_id uuid not null references public.nests (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_channel_created on public.messages (channel_id, created_at desc);
create index if not exists nest_members_user on public.nest_members (user_id);
create index if not exists channels_nest on public.channels (nest_id, position);

-- ---------------------------------------------------------------- funções

-- É membro do Nest? (security definer evita recursão nas regras)
create or replace function public.is_member(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from nest_members where nest_id = n and user_id = auth.uid());
$$;

create or replace function public.is_owner(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from nests where id = n and owner_id = auth.uid());
$$;

-- Perfil criado automaticamente no cadastro
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Cria um Nest com o dono e os canais iniciais, tudo de uma vez
create or replace function public.create_nest(nest_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into nests (name, owner_id) values (trim(nest_name), auth.uid()) returning id into novo;
  insert into nest_members (nest_id, user_id, role) values (novo, auth.uid(), 'owner');
  insert into channels (nest_id, name, kind, position) values
    (novo, 'general', 'text', 0),
    (novo, 'General', 'voice', 1),
    (novo, 'Gaming', 'voice', 2);
  return novo;
end;
$$;

-- Entra num Nest pelo código de convite
create or replace function public.join_nest(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare alvo uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into alvo from nests where invite_code = lower(trim(code));
  if alvo is null then raise exception 'invalid invite'; end if;
  insert into nest_members (nest_id, user_id) values (alvo, auth.uid()) on conflict do nothing;
  return alvo;
end;
$$;

-- Gera um código de convite novo (o antigo para de funcionar)
create or replace function public.reset_invite(n uuid)
returns text language plpgsql security definer set search_path = public as $$
declare novo text := lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
begin
  if not is_owner(n) then raise exception 'only the owner can do this'; end if;
  update nests set invite_code = novo where id = n;
  return novo;
end;
$$;

-- A mensagem herda o nest do canal (o app não precisa mandar)
create or replace function public.set_message_nest()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select nest_id into new.nest_id from channels where id = new.channel_id;
  return new;
end;
$$;

drop trigger if exists messages_set_nest on public.messages;
create trigger messages_set_nest before insert on public.messages
  for each row execute function public.set_message_nest();

-- ---------------------------------------------------------------- regras (RLS)

alter table public.profiles enable row level security;
alter table public.nests enable row level security;
alter table public.nest_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles: ver" on public.profiles;
create policy "profiles: ver" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles: editar o seu" on public.profiles;
create policy "profiles: editar o seu" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "nests: membros veem" on public.nests;
create policy "nests: membros veem" on public.nests for select to authenticated using (is_member(id));
drop policy if exists "nests: dono edita" on public.nests;
create policy "nests: dono edita" on public.nests for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "nests: dono apaga" on public.nests;
create policy "nests: dono apaga" on public.nests for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "membros: veem os do mesmo nest" on public.nest_members;
create policy "membros: veem os do mesmo nest" on public.nest_members for select to authenticated using (is_member(nest_id));
drop policy if exists "membros: sair ou dono remove" on public.nest_members;
create policy "membros: sair ou dono remove" on public.nest_members for delete to authenticated
  using (user_id = auth.uid() or is_owner(nest_id));

drop policy if exists "canais: membros veem" on public.channels;
create policy "canais: membros veem" on public.channels for select to authenticated using (is_member(nest_id));
drop policy if exists "canais: dono cria" on public.channels;
create policy "canais: dono cria" on public.channels for insert to authenticated with check (is_owner(nest_id));
drop policy if exists "canais: dono edita" on public.channels;
create policy "canais: dono edita" on public.channels for update to authenticated using (is_owner(nest_id)) with check (is_owner(nest_id));
drop policy if exists "canais: dono apaga" on public.channels;
create policy "canais: dono apaga" on public.channels for delete to authenticated using (is_owner(nest_id));

drop policy if exists "mensagens: membros veem" on public.messages;
create policy "mensagens: membros veem" on public.messages for select to authenticated using (is_member(nest_id));
drop policy if exists "mensagens: membros escrevem" on public.messages;
create policy "mensagens: membros escrevem" on public.messages for insert to authenticated
  with check (author_id = auth.uid() and is_member((select nest_id from public.channels where id = channel_id)));
drop policy if exists "mensagens: apagar a sua" on public.messages;
create policy "mensagens: apagar a sua" on public.messages for delete to authenticated using (author_id = auth.uid() or is_owner(nest_id));

grant execute on function public.create_nest(text), public.join_nest(text), public.reset_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- tempo real

do $$
begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.channels; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.nest_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.nests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------- fotos de perfil

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars: enviar a sua" on storage.objects;
create policy "avatars: enviar a sua" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars: trocar a sua" on storage.objects;
create policy "avatars: trocar a sua" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
