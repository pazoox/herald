-- Herald — cargos nos Nests (rodar depois do schema.sql; pode rodar de novo sem problema)
--
--   owner      quem criou (só um; é o nests.owner_id) — pode tudo
--   admin      edita o Nest, mexe nos canais, troca cargos de Member/Moderator, expulsa Moderators e Members
--   moderator  apaga mensagens dos outros e expulsa Members
--   member     conversa, voz, tela, Rádio, Roleta e convida gente
--
-- Cargos só mudam pelas funções abaixo (ninguém consegue se promover direto na tabela).

alter table public.nest_members drop constraint if exists nest_members_role_check;
alter table public.nest_members add constraint nest_members_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

-- ---------------------------------------------------------------- níveis

create or replace function public.role_level(r text)
returns int language sql immutable as $$
  select case r when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 when 'member' then 0 else -1 end;
$$;

-- Nível de alguém num Nest (o dono do nests.owner_id é sempre 3)
create or replace function public.level_of(n uuid, u uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from nests where id = n and owner_id = u) then 3
    else coalesce((select role_level(role) from nest_members where nest_id = n and user_id = u), -1)
  end;
$$;

create or replace function public.my_level(n uuid)
returns int language sql stable security definer set search_path = public as $$
  select level_of(n, auth.uid());
$$;

create or replace function public.is_admin(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select my_level(n) >= 2;
$$;

create or replace function public.is_mod(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select my_level(n) >= 1;
$$;

-- ---------------------------------------------------------------- regras

-- Nest: Admin edita só nome e ícone; dono e convite mudam pelas funções
drop policy if exists "nests: dono edita" on public.nests;
drop policy if exists "nests: admin edita" on public.nests;
create policy "nests: admin edita" on public.nests for update to authenticated using (is_admin(id)) with check (is_admin(id));
revoke update on public.nests from authenticated;
grant update (name, icon_url) on public.nests to authenticated;

-- Canais: Admin pra cima
drop policy if exists "canais: dono cria" on public.channels;
drop policy if exists "canais: admin cria" on public.channels;
create policy "canais: admin cria" on public.channels for insert to authenticated with check (is_admin(nest_id));
drop policy if exists "canais: dono edita" on public.channels;
drop policy if exists "canais: admin edita" on public.channels;
create policy "canais: admin edita" on public.channels for update to authenticated using (is_admin(nest_id)) with check (is_admin(nest_id));
drop policy if exists "canais: dono apaga" on public.channels;
drop policy if exists "canais: admin apaga" on public.channels;
create policy "canais: admin apaga" on public.channels for delete to authenticated using (is_admin(nest_id));

-- Mensagens: a sua, ou Moderator pra cima apaga a dos outros
drop policy if exists "mensagens: apagar a sua" on public.messages;
create policy "mensagens: apagar a sua" on public.messages for delete to authenticated
  using (author_id = auth.uid() or is_mod(nest_id));

-- Sair (menos o dono, que precisa passar a posse ou apagar) ou expulsar quem está abaixo de você
drop policy if exists "membros: sair ou dono remove" on public.nest_members;
drop policy if exists "membros: sair ou expulsar" on public.nest_members;
create policy "membros: sair ou expulsar" on public.nest_members for delete to authenticated
  using (
    (user_id = auth.uid() and role <> 'owner')
    or (my_level(nest_id) >= 1 and my_level(nest_id) > level_of(nest_id, user_id))
  );

-- ---------------------------------------------------------------- funções

-- Troca o cargo de alguém: só pra baixo de você (Admin mexe em Member/Moderator; dono também em Admin)
create or replace function public.set_member_role(n uuid, target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare eu int := my_level(n);
begin
  if new_role not in ('admin', 'moderator', 'member') then raise exception 'invalid role'; end if;
  if target = auth.uid() then raise exception 'you cannot change your own role'; end if;
  if not exists (select 1 from nest_members where nest_id = n and user_id = target) then raise exception 'not a member'; end if;
  if eu < 2 or level_of(n, target) >= eu or role_level(new_role) >= eu then
    raise exception 'not allowed';
  end if;
  update nest_members set role = new_role where nest_id = n and user_id = target;
end;
$$;

-- Passa o Nest pra outra pessoa (o dono antigo vira Admin)
create or replace function public.transfer_nest(n uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(n) then raise exception 'only the owner can do this'; end if;
  if target = auth.uid() then raise exception 'already the owner'; end if;
  if not exists (select 1 from nest_members where nest_id = n and user_id = target) then raise exception 'not a member'; end if;
  update nests set owner_id = target where id = n;
  update nest_members set role = 'owner' where nest_id = n and user_id = target;
  update nest_members set role = 'admin' where nest_id = n and user_id = auth.uid();
end;
$$;

-- Link de convite novo: Admin pra cima
create or replace function public.reset_invite(n uuid)
returns text language plpgsql security definer set search_path = public as $$
declare novo text := lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
begin
  if not is_admin(n) then raise exception 'not allowed'; end if;
  update nests set invite_code = novo where id = n;
  return novo;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid, text), public.transfer_nest(uuid, uuid), public.reset_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- ícone do Nest
-- Fica no bucket "avatars", na pasta nest-<id>; só Admin pra cima envia

drop policy if exists "avatars: icone do nest" on storage.objects;
create policy "avatars: icone do nest" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] ~ '^nest-[0-9a-f-]{36}$'
    and is_admin(substring((storage.foldername(name))[1] from 6)::uuid));
drop policy if exists "avatars: trocar icone do nest" on storage.objects;
create policy "avatars: trocar icone do nest" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] ~ '^nest-[0-9a-f-]{36}$'
    and is_admin(substring((storage.foldername(name))[1] from 6)::uuid));
