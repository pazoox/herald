-- Herald — calibração da voz (rodar depois do schema.sql; pode rodar de novo sem problema)
-- Um perfil por pessoa e por microfone (o mic é identificado pelo nome, ex.: "Fifine Microphone").
-- O perfil guarda o EQ calculado na calibração; só a própria pessoa lê e grava o dela.

create table if not exists public.voice_profiles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mic text not null check (char_length(mic) between 1 and 120),
  profile jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, mic)
);

alter table public.voice_profiles enable row level security;

drop policy if exists "voz: ver o seu" on public.voice_profiles;
create policy "voz: ver o seu" on public.voice_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "voz: criar o seu" on public.voice_profiles;
create policy "voz: criar o seu" on public.voice_profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "voz: trocar o seu" on public.voice_profiles;
create policy "voz: trocar o seu" on public.voice_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "voz: apagar o seu" on public.voice_profiles;
create policy "voz: apagar o seu" on public.voice_profiles for delete to authenticated using (user_id = auth.uid());
