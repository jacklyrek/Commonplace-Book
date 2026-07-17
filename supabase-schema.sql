-- Commonplace Book — Phase 2 sync schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- Mirrors the local IndexedDB stores 1:1. Rows are never hard-deleted by the
-- app; deletions arrive as tombstones (deleted = true) so they propagate to
-- every device. Content columns are nullable because a tombstone may be the
-- first version of a row the server ever sees.
--
-- Two timestamps, two jobs, do not mix them up:
--   updated_at — when the user last touched the row, stamped by the device.
--                Used only to resolve conflicts (last write wins).
--   synced_at  — when the row last reached this table, stamped by Postgres and
--                never accepted from the client. Used only to page through
--                changes. Device clocks disagree, so a client timestamp cannot
--                do this job: a fast clock would strand slower devices' rows.

create table public.tags (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text,
  kind       text,          -- 'book' | 'topic'
  author     text,          -- only for kind = 'book'
  created_at timestamptz,
  updated_at timestamptz not null,
  synced_at  timestamptz not null default clock_timestamp(),
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
  synced_at  timestamptz not null default clock_timestamp(),
  deleted    boolean not null default false
);

create table public.entry_tags (
  id         text primary key,  -- '<entry_id>::<tag_id>'
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id   uuid,
  tag_id     uuid,
  created_at timestamptz,
  updated_at timestamptz not null,
  synced_at  timestamptz not null default clock_timestamp(),
  deleted    boolean not null default false
);

-- Stamps synced_at on every write, overriding anything the client sent.
create or replace function public.stamp_synced_at()
returns trigger language plpgsql as $$
begin
  -- clock_timestamp(), not now(): now() is transaction-start time, so two
  -- overlapping writes can land out of order relative to their stamps.
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create trigger tags_stamp_synced_at before insert or update on public.tags
  for each row execute function public.stamp_synced_at();
create trigger entries_stamp_synced_at before insert or update on public.entries
  for each row execute function public.stamp_synced_at();
create trigger entry_tags_stamp_synced_at before insert or update on public.entry_tags
  for each row execute function public.stamp_synced_at();

-- The app pulls "changes since last sync" by synced_at.
create index entries_user_synced on public.entries (user_id, synced_at);
create index tags_user_synced on public.tags (user_id, synced_at);
create index entry_tags_user_synced on public.entry_tags (user_id, synced_at);

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
