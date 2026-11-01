-- Shadad Split Tracker cloud storage for Supabase
-- Run ONCE in your Supabase project's SQL Editor (or re-run to update the function).
-- The public website uses ONLY the publishable key; never expose the secret/service_role key.

create table if not exists public.shadad_workout_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.shadad_workout_snapshots enable row level security;
revoke all on public.shadad_workout_snapshots from anon, authenticated;
grant select, insert, update on public.shadad_workout_snapshots to authenticated;

drop policy if exists "Shadad owner select" on public.shadad_workout_snapshots;
drop policy if exists "Shadad owner insert" on public.shadad_workout_snapshots;
drop policy if exists "Shadad owner update" on public.shadad_workout_snapshots;

create policy "Shadad owner select" on public.shadad_workout_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Shadad owner insert" on public.shadad_workout_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Shadad owner update" on public.shadad_workout_snapshots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap: do not silently overwrite another device's changes.
-- SECURITY INVOKER retains the caller's RLS and table permissions.
create or replace function public.shadad_save_snapshot(
  p_payload jsonb, p_expected_revision bigint
)
returns table(applied boolean, new_revision bigint, current_payload jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid snapshot';
  end if;
  if octet_length(p_payload::text) > 1048576 then
    raise exception 'Snapshot larger than 1 MiB';
  end if;
  if p_expected_revision is null then
    insert into public.shadad_workout_snapshots (user_id, payload, revision)
    values (v_user, p_payload, 1)
    on conflict (user_id) do nothing
    returning revision into v_revision;
  else
    update public.shadad_workout_snapshots s
       set payload = p_payload, revision = s.revision + 1, updated_at = now()
     where s.user_id = v_user and s.revision = p_expected_revision
    returning revision into v_revision;
  end if;

  if v_revision is not null then
    return query select true, v_revision, p_payload;
    return;
  end if;

  return query select false, s.revision, s.payload
    from public.shadad_workout_snapshots s
    where s.user_id = v_user;
end $$;

revoke all on function public.shadad_save_snapshot(jsonb,bigint) from public, anon;
grant execute on function public.shadad_save_snapshot(jsonb,bigint) to authenticated;
