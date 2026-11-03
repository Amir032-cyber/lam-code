-- LAM-Code : schéma initial (projets, messages, snapshots) avec RLS par utilisateur.
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id text not null,
  name text not null check (char_length(name) between 1 and 200),
  files jsonb not null default '{"files": [], "dirs": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 200),
  storage_path text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);
create index if not exists messages_project_idx on public.messages (project_id, created_at);
create index if not exists snapshots_project_idx on public.snapshots (project_id, created_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.snapshots enable row level security;

create policy "projects_select_own" on public.projects for select to authenticated using (user_id = auth.uid());
create policy "projects_insert_own" on public.projects for insert to authenticated with check (user_id = auth.uid());
create policy "projects_update_own" on public.projects for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "projects_delete_own" on public.projects for delete to authenticated using (user_id = auth.uid());

create policy "messages_select_own" on public.messages for select to authenticated using (user_id = auth.uid());
create policy "messages_insert_own" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "messages_delete_own" on public.messages for delete to authenticated using (user_id = auth.uid());

create policy "snapshots_select_own" on public.snapshots for select to authenticated using (user_id = auth.uid());
create policy "snapshots_insert_own" on public.snapshots for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "snapshots_delete_own" on public.snapshots for delete to authenticated using (user_id = auth.uid());

-- Stockage des archives zip : bucket privé, un dossier par utilisateur (<uid>/<projet>/<fichier>.zip).
insert into storage.buckets (id, name, public) values ('snapshots', 'snapshots', false)
  on conflict (id) do nothing;

create policy "snapshots_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'snapshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "snapshots_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'snapshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "snapshots_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'snapshots' and (storage.foldername(name))[1] = auth.uid()::text);
