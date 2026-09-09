-- ARMATURE MONITORING SYSTEM
-- DEV / DUMMY SUPABASE ONLY
-- Persistent request ordering for DEV/DUMMY only. Do not run against production.
-- Pending requests are ordered by requested_at ASC, then id ASC
-- as a deterministic tie-breaker. Historical/non-active requests get NULL.

begin;

alter table public.armature_requests
  add column if not exists request_sequence integer;

-- Normalize existing DEV data before enabling the invariant for new writes.
with ranked_active_requests as (
  select
    id,
    row_number() over (order by requested_at asc, id asc)::integer as sequence_number
  from public.armature_requests
  where status = 'PENDING'
)
update public.armature_requests as requests
set request_sequence = ranked_active_requests.sequence_number
from ranked_active_requests
where requests.id = ranked_active_requests.id;

update public.armature_requests
set request_sequence = null
where status <> 'PENDING';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_request_sequence_positive'
      and conrelid = 'public.armature_requests'::regclass
  ) then
    alter table public.armature_requests
      add constraint chk_request_sequence_positive
      check (request_sequence is null or request_sequence > 0);
  end if;
end;
$$;

create index if not exists idx_requests_active_sequence
  on public.armature_requests (request_sequence asc, requested_at asc, id)
  where status = 'PENDING';

-- Keep the existing one-active-request-per-armature rule aligned with the
-- current PENDING-only active queue.
drop index if exists public.uq_one_active_request_per_armature;
create unique index uq_one_active_request_per_armature
  on public.armature_requests (armature_id)
  where status = 'PENDING';

-- Each active request has one sequence value. NULL remains valid only for
-- non-active/history rows and for the short internal reorder transaction.
create unique index if not exists uq_requests_active_sequence
  on public.armature_requests (request_sequence)
  where status = 'PENDING';

-- Direct client writes remain disabled. Sequence changes happen through RPC only.
revoke insert, update, delete on public.armature_requests
  from public, anon, authenticated;

-- ============================================================
-- RPC: VIEWER CREATE REQUEST WITH APPENDED SEQUENCE
-- ============================================================

create or replace function public.create_armature_request(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.armature_requests;
  v_next_sequence integer;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can create request';
  end if;

  if p_quantity_box is null or p_quantity_box <= 0 then
    raise exception 'Request quantity must be greater than 0';
  end if;

  if not exists (
    select 1
    from public.armatures as a
    where a.id = p_armature_id
      and a.is_active = true
  ) then
    raise exception 'Armature not found or inactive';
  end if;

  -- Serialize sequence allocation and the active-request duplicate check.
  perform pg_advisory_xact_lock(74289113016884521::bigint);

  if exists (
    select 1
    from public.armature_requests as existing_request
    where existing_request.armature_id = p_armature_id
      and existing_request.status = 'PENDING'
  ) then
    raise exception 'This armature already has an active request';
  end if;

  select coalesce(max(request_sequence), 0) + 1
  into v_next_sequence
  from public.armature_requests
  where status = 'PENDING';

  insert into public.armature_requests (
    armature_id,
    requested_quantity_box,
    request_sequence,
    requested_by
  )
  values (
    p_armature_id,
    p_quantity_box,
    v_next_sequence,
    auth.uid()
  )
  returning * into v_request;

  return v_request;

exception
  when unique_violation then
    raise exception 'This armature already has an active request';
end;
$$;

-- Keep pending sequence values contiguous after a request leaves the queue.
-- The caller holds the shared advisory lock used by all sequence writers.
create or replace function private.normalize_pending_request_sequences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending_request record;
begin
  -- Each target rank is less than or equal to the existing positive sequence,
  -- so ascending updates keep the partial unique index valid at every step.
  for v_pending_request in
    select
      id,
      row_number() over (order by request_sequence asc nulls last, requested_at asc, id asc)::integer as sequence_number
    from public.armature_requests
    where status = 'PENDING'
    order by request_sequence asc nulls last, requested_at asc, id asc
  loop
    update public.armature_requests
    set request_sequence = v_pending_request.sequence_number
    where id = v_pending_request.id;
  end loop;
end;
$$;

-- BOP advances requests through PENDING -> ONGOING -> DONE.
-- No stock or usage row is changed here.
create or replace function public.update_request_status(
  p_request_id uuid,
  p_status public.request_status
)
returns public.armature_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.armature_requests;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can handle request';
  end if;

  if p_status not in (
    'ONGOING'::public.request_status,
    'DONE'::public.request_status
  ) then
    raise exception 'Only ONGOING or DONE status is allowed';
  end if;

  perform pg_advisory_xact_lock(74289113016884521::bigint);

  select *
  into v_request
  from public.armature_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.status = 'PENDING'
     and p_status = 'ONGOING'::public.request_status then

    update public.armature_requests
    set status = 'ONGOING',
        handled_by = auth.uid(),
        completed_at = null
    where id = p_request_id
    returning * into v_request;

  elsif v_request.status = 'ONGOING'
        and p_status = 'DONE'::public.request_status then

    update public.armature_requests
    set status = 'DONE',
        handled_by = auth.uid(),
        completed_at = now(),
        request_sequence = null
    where id = p_request_id
    returning * into v_request;

  else
    raise exception 'Invalid request status transition';
  end if;

  return v_request;
end;
$$;

-- BOP can delete only a pending request.
create or replace function public.delete_armature_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can delete request';
  end if;

  perform pg_advisory_xact_lock(74289113016884521::bigint);

  delete from public.armature_requests
  where id = p_request_id
    and status = 'PENDING'
  returning id into v_request_id;

  if not found then
    raise exception 'Pending request not found';
  end if;

  perform private.normalize_pending_request_sequences();
  return v_request_id;
end;
$$;

-- ============================================================
-- RPC: VIEWER REORDER ACTIVE REQUESTS
-- ============================================================

create or replace function public.reorder_armature_requests(
  p_request_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplied_count integer;
  v_unique_count integer;
  v_active_count integer;
  v_matching_count integer;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can reorder requests';
  end if;

  if p_request_ids is null or cardinality(p_request_ids) = 0 then
    raise exception 'At least one active request is required';
  end if;

  if exists (
    select 1
    from unnest(p_request_ids) as supplied(request_id)
    where supplied.request_id is null
  ) then
    raise exception 'Request IDs cannot be null';
  end if;

  select count(*)::integer, count(distinct supplied.request_id)::integer
  into v_supplied_count, v_unique_count
  from unnest(p_request_ids) as supplied(request_id);

  if v_supplied_count <> v_unique_count then
    raise exception 'Duplicate request IDs are not allowed';
  end if;

  -- Keep the critical transaction short and serialize all sequence writers.
  perform pg_advisory_xact_lock(74289113016884521::bigint);

  select count(*)::integer
  into v_active_count
  from public.armature_requests
  where status = 'PENDING';

  if v_supplied_count <> v_active_count then
    raise exception 'The complete active request list is required';
  end if;

  select count(*)::integer
  into v_matching_count
  from public.armature_requests
  where id = any (p_request_ids)
    and status = 'PENDING';

  if v_matching_count <> v_supplied_count then
    raise exception 'All request IDs must belong to active requests';
  end if;

  -- Clear active values first so swaps/reversals do not violate the unique
  -- sequence index midway through a single atomic transaction.
  update public.armature_requests
  set request_sequence = null
  where status = 'PENDING';

  update public.armature_requests as requests
  set request_sequence = ordered.new_sequence
  from unnest(p_request_ids) with ordinality as ordered(request_id, new_sequence)
  where requests.id = ordered.request_id
    and requests.status = 'PENDING';

  return v_supplied_count;
end;
$$;

revoke execute on function public.create_armature_request(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.create_armature_request(uuid, integer)
  to authenticated;

revoke execute on function private.normalize_pending_request_sequences()
  from public, anon, authenticated;

revoke execute on function public.update_request_status(uuid, public.request_status)
  from public, anon, authenticated;
grant execute on function public.update_request_status(uuid, public.request_status)
  to authenticated;

revoke execute on function public.delete_armature_request(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_armature_request(uuid)
  to authenticated;

revoke execute on function public.reorder_armature_requests(uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_armature_requests(uuid[])
  to authenticated;

-- ============================================================
-- DEV DASHBOARD VIEW: EXPOSE PERSISTED REQUEST SEQUENCE
-- ============================================================

create or replace view public.armature_dashboard
with (security_invoker = true)
as
select
  a.id,
  a.part_number,
  a.armature_type,
  a.color,
  a.konmi,
  a.is_active,
  coalesce(s.quantity_box, 0) as quantity_box,
  case
    when coalesce(s.quantity_box, 0) = 0 then 'EMPTY'
    else 'READY'
  end as stock_status,
  s.updated_at as last_stock_update,
  s.updated_by as stock_updated_by_id,
  private.get_profile_name(s.updated_by) as stock_updated_by,
  r.id as active_request_id,
  r.requested_quantity_box as active_request_quantity_box,
  r.status as active_request_status,
  r.requested_at as active_request_at,
  r.requested_by as requested_by_id,
  private.get_profile_name(r.requested_by) as requested_by,
  r.handled_by as handled_by_id,
  private.get_profile_name(r.handled_by) as handled_by,
  r.request_sequence
from public.armatures as a
left join public.armature_stock as s
  on s.armature_id = a.id
left join public.armature_requests as r
  on r.armature_id = a.id
 and r.status in ('PENDING', 'ONGOING')
where a.is_active = true;

-- Done requests are permanent history and intentionally do not participate
-- in the active request sequence.
create or replace view public.armature_request_history
with (security_invoker = true)
as
select
  r.id,
  r.armature_id,
  a.part_number,
  a.armature_type,
  r.requested_quantity_box,
  r.status,
  r.requested_at,
  r.requested_by as requested_by_id,
  private.get_profile_name(r.requested_by) as requested_by,
  r.handled_by as handled_by_id,
  private.get_profile_name(r.handled_by) as handled_by,
  r.updated_at as handled_at
from public.armature_requests as r
join public.armatures as a
  on a.id = r.armature_id
where r.status = 'DONE';

revoke all privileges on table public.armature_request_history
  from public, anon;
grant select on table public.armature_request_history
  to authenticated;

commit;

-- END OF DEV REQUEST SEQUENCE MIGRATION
