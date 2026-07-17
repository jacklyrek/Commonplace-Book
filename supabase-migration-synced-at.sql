-- Commonplace Book — migration: server-authored synced_at.
-- Run once against an existing project: Dashboard → SQL Editor → paste → Run.
-- Projects created from the current supabase-schema.sql already have this.
--
-- Why: the app pulled changes with `updated_at > watermark`, but updated_at is
-- stamped by whichever device wrote the row. A device that pushed its watermark
-- past another device's clock stopped matching that device's rows, and no later
-- sync would ever match them again — notes went missing permanently rather than
-- arriving late.
--
-- synced_at is stamped by Postgres on every insert and update and is never taken
-- from the client, so every device pages through one monotonic clock. updated_at
-- stays, but only for last-write-wins conflict resolution, which is what a
-- client-authored "when did the user touch this" timestamp is actually good for.

create or replace function public.stamp_synced_at()
returns trigger language plpgsql as $$
begin
  -- clock_timestamp(), not now(): now() is transaction-start time, so two
  -- overlapping writes can land out of order relative to their stamps.
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

-- Existing rows default to "now", so the first sync after this migration re-pulls
-- everything once. That is the intended repair: devices stranded by the old
-- watermark get the rows they never saw, merged last-write-wins.
alter table public.tags
  add column if not exists synced_at timestamptz not null default clock_timestamp();
alter table public.entries
  add column if not exists synced_at timestamptz not null default clock_timestamp();
alter table public.entry_tags
  add column if not exists synced_at timestamptz not null default clock_timestamp();

-- The trigger overrides whatever the client sends, so synced_at cannot be forged
-- or skewed by a device with a bad clock.
drop trigger if exists tags_stamp_synced_at on public.tags;
create trigger tags_stamp_synced_at before insert or update on public.tags
  for each row execute function public.stamp_synced_at();

drop trigger if exists entries_stamp_synced_at on public.entries;
create trigger entries_stamp_synced_at before insert or update on public.entries
  for each row execute function public.stamp_synced_at();

drop trigger if exists entry_tags_stamp_synced_at on public.entry_tags;
create trigger entry_tags_stamp_synced_at before insert or update on public.entry_tags
  for each row execute function public.stamp_synced_at();

-- Pull is now "changes since watermark" ordered by synced_at.
create index if not exists tags_user_synced on public.tags (user_id, synced_at);
create index if not exists entries_user_synced on public.entries (user_id, synced_at);
create index if not exists entry_tags_user_synced on public.entry_tags (user_id, synced_at);
