-- Commonplace Book — Phase 2 sync schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- Mirrors the local IndexedDB stores 1:1. Rows are never hard-deleted by the
-- app; deletions arrive as tombstones (deleted = true) so they propagate to
-- every device. Content columns are nullable because a tombstone may be the
-- first version of a row the server ever sees.

create table public.tags (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text,
  kind       text,          -- 'book' | 'topic'
  author     text,          -- only for kind = 'book'
  created_at timestamptz,
  updated_at timestamptz not null,
  deleted    boolean not null default false
);

create table public.entries (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quote      text,
  reflection text,
  page       text,
  starred    boolean,
  created_at timestamptz,
  updated_at timestamptz not null,
  deleted    boolean not null default false
);

create table public.entry_tags (
  id         text primary key,  -- '<entry_id>::<tag_id>'
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id   uuid,
  tag_id     uuid,
  created_at timestamptz,
  updated_at timestamptz not null,
  deleted    boolean not null default false
);

-- The app pulls "changes since last sync" by updated_at.
create index entries_user_updated on public.entries (user_id, updated_at);
create index tags_user_updated on public.tags (user_id, updated_at);
create index entry_tags_user_updated on public.entry_tags (user_id, updated_at);

-- Row-level security: each user sees only their own rows.
alter table public.tags enable row level security;
alter table public.entries enable row level security;
alter table public.entry_tags enable row level security;

create policy "own tags" on public.tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own entries" on public.entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own entry_tags" on public.entry_tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
