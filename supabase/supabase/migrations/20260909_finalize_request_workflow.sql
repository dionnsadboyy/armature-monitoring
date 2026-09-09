begin;

-- ============================================================
-- 1. REQUEST SEQUENCE
-- ============================================================

alter table public.armature_requests
  add column if not exists request_sequence integer;

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
end
$$;

-- ============================================================
-- 2. FINAL COMPLETED_AT CONSTRAINT
-- PENDING / ONGOING = completed_at NULL
-- DONE = completed_at NOT NULL
-- ============================================================

alter table public.armature_requests
  drop constraint if exists chk_request_completed_at;

-- Normalize existing rows first.
update public.armature_requests
set completed_at = null
where status in ('PENDING', 'ONGOING');

update public.armature_requests
set completed_at = coalesce(completed_at, updated_at, now())
where status = 'DONE';

alter table public.armature_requests
  add constraint chk_request_completed_at
  check (
    (status in ('PENDING', 'ONGOING') and completed_at is null)
    or
    (status = 'DONE' and completed_at is not null)
  );

-- ============================================================
-- 3. ACTIVE REQUEST INDEXES
-- ============================================================

drop index if exists public.uq_one_active_request_per_armature;

create unique index uq_one_active_request_per_armature
  on public.armature_requests (armature_id)
  where status in ('PENDING', 'ONGOING');

drop index if exists public.idx_requests_active_sequence;

create index idx_requests_active_sequence
  on public.armature_requests (
    request_sequence asc,
    requested_at asc,
    id
  )
  where status in ('PENDING', 'ONGOING');

drop index if exists public.uq_requests_active_sequence;

create unique index uq_requests_active_sequence
  on public.armature_requests (request_sequence)
  where status in ('PENDING', 'ONGOING');

-- ============================================================
-- 4. NORMALIZE EXISTING ACTIVE SEQUENCE
-- ============================================================

do $$
declare
  v_request record;
begin

  update public.armature_requests
  set request_sequence = null
  where status in ('PENDING', 'ONGOING');

  for v_request in
    select
      id,
      row_number() over (
        order by requested_at asc, id asc
      )::integer as new_sequence
    from public.armature_requests
    where status in ('PENDING', 'ONGOING')
    order by requested_at asc, id asc
  loop

    update public.armature_requests
    set request_sequence = v_request.new_sequence
    where id = v_request.id;

  end loop;

end
$$;

-- ============================================================
-- 5. PRIVATE NORMALIZE FUNCTION
-- ============================================================

create or replace function private.normalize_active_request_sequences()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request record;
begin

  update public.armature_requests
  set request_sequence = null
  where status in ('PENDING', 'ONGOING');

  for v_request in
    select
      id,
      row_number() over (
        order by requested_at asc, id asc
      )::integer as new_sequence
    from public.armature_requests
    where status in ('PENDING', 'ONGOING')
    order by requested_at asc, id asc
  loop

    update public.armature_requests
    set request_sequence = v_request.new_sequence
    where id = v_request.id;

  end loop;

end;
$function$;

revoke execute
on function private.normalize_active_request_sequences()
from public, anon, authenticated;

-- ============================================================
-- 6. CREATE REQUEST
-- ============================================================

create or replace function public.create_armature_request(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.armature_requests;
  v_next_sequence integer;
begin

  if auth.uid() is null
     or private.get_my_role()
        is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can create request';
  end if;

  if p_quantity_box is null or p_quantity_box <= 0 then
    raise exception 'Request quantity must be greater than 0';
  end if;

  if not exists (
    select 1
    from public.armatures
    where id = p_armature_id
      and is_active = true
  ) then
    raise exception 'Armature not found or inactive';
  end if;

  perform pg_advisory_xact_lock(
    74289113016884521::bigint
  );

  if exists (
    select 1
    from public.armature_requests
    where armature_id = p_armature_id
      and status in ('PENDING', 'ONGOING')
  ) then
    raise exception 'This armature already has an active request';
  end if;

  select coalesce(max(request_sequence), 0) + 1
  into v_next_sequence
  from public.armature_requests
  where status in ('PENDING', 'ONGOING');

  insert into public.armature_requests (
    armature_id,
    requested_quantity_box,
    status,
    request_sequence,
    requested_by
  )
  values (
    p_armature_id,
    p_quantity_box,
    'PENDING',
    v_next_sequence,
    auth.uid()
  )
  returning * into v_request;

  return v_request;

exception
  when unique_violation then
    raise exception 'This armature already has an active request';
end;
$function$;

-- ============================================================
-- 7. STATUS FLOW
-- PENDING -> ONGOING -> DONE
-- ============================================================

create or replace function public.update_request_status(
  p_request_id uuid,
  p_status public.request_status
)
returns public.armature_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.armature_requests;
begin

  if auth.uid() is null
     or private.get_my_role()
        is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can handle requests';
  end if;

  if p_status is null then
    raise exception 'Status is required';
  end if;

  select *
  into v_request
  from public.armature_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.status = 'DONE' then
    raise exception 'Request is already DONE';
  end if;

  -- PENDING -> ONGOING
  if p_status = 'ONGOING' then

    if v_request.status <> 'PENDING' then
      raise exception 'Only PENDING request can become ONGOING';
    end if;

    update public.armature_requests
    set
      status = 'ONGOING',
      handled_by = auth.uid()
    where id = p_request_id
    returning * into v_request;

    return v_request;

  end if;

  -- ONGOING -> DONE
  if p_status = 'DONE' then

    if v_request.status <> 'ONGOING' then
      raise exception 'Only ONGOING request can become DONE';
    end if;

    insert into public.armature_stock as current_stock (
      armature_id,
      quantity_box,
      updated_by,
      updated_at
    )
    values (
      v_request.armature_id,
      v_request.requested_quantity_box,
      auth.uid(),
      now()
    )
    on conflict (armature_id)
    do update set
      quantity_box = current_stock.quantity_box + excluded.quantity_box,
      updated_by = auth.uid(),
      updated_at = now();

    update public.armature_requests
    set
      status = 'DONE',
      handled_by = auth.uid(),
      completed_at = now(),
      request_sequence = null
    where id = p_request_id
    returning * into v_request;

    perform private.normalize_active_request_sequences();

    return v_request;

  end if;

  raise exception 'Unsupported status transition';

end;
$function$;

-- ============================================================
-- 8. DELETE PENDING ONLY
-- ============================================================

create or replace function public.delete_armature_request(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id uuid;
begin

  if auth.uid() is null
     or private.get_my_role()
        is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can delete request';
  end if;

  perform pg_advisory_xact_lock(
    74289113016884521::bigint
  );

  delete from public.armature_requests
  where id = p_request_id
    and status = 'PENDING'
  returning id into v_request_id;

  if not found then
    raise exception 'Pending request not found';
  end if;

  perform private.normalize_active_request_sequences();

  return v_request_id;

end;
$function$;

-- ============================================================
-- 9. DRAG & DROP REORDER
-- PENDING + ONGOING
-- ============================================================

create or replace function public.reorder_armature_requests(
  p_request_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_supplied_count integer;
  v_unique_count integer;
  v_active_count integer;
  v_matching_count integer;
begin

  if auth.uid() is null
     or private.get_my_role()
        is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can reorder requests';
  end if;

  if p_request_ids is null
     or cardinality(p_request_ids) = 0 then
    raise exception 'At least one active request is required';
  end if;

  select
    count(*)::integer,
    count(distinct request_id)::integer
  into
    v_supplied_count,
    v_unique_count
  from unnest(p_request_ids) as t(request_id);

  if v_supplied_count <> v_unique_count then
    raise exception 'Duplicate request IDs are not allowed';
  end if;

  perform pg_advisory_xact_lock(
    74289113016884521::bigint
  );

  select count(*)::integer
  into v_active_count
  from public.armature_requests
  where status in ('PENDING', 'ONGOING');

  if v_supplied_count <> v_active_count then
    raise exception 'The complete active request list is required';
  end if;

  select count(*)::integer
  into v_matching_count
  from public.armature_requests
  where id = any(p_request_ids)
    and status in ('PENDING', 'ONGOING');

  if v_matching_count <> v_supplied_count then
    raise exception 'All request IDs must belong to active requests';
  end if;

  update public.armature_requests
  set request_sequence = null
  where status in ('PENDING', 'ONGOING');

  update public.armature_requests as requests
  set request_sequence = ordered.new_sequence
  from unnest(p_request_ids)
    with ordinality as ordered(request_id, new_sequence)
  where requests.id = ordered.request_id
    and requests.status in ('PENDING', 'ONGOING');

  return v_supplied_count;

end;
$function$;

-- ============================================================
-- 10. DASHBOARD VIEW
-- ============================================================

drop view if exists public.armature_dashboard;

create view public.armature_dashboard
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
    when coalesce(s.quantity_box, 0) = 0
      then 'EMPTY'
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

-- ============================================================
-- 11. HISTORY VIEW
-- ============================================================

drop view if exists public.armature_request_history;

create view public.armature_request_history
with (security_invoker = true)
as
select
  r.id,
  r.armature_id,
  a.part_number,
  a.armature_type,
  a.color,
  a.konmi,
  r.requested_quantity_box,
  r.status,
  r.requested_at,
  r.requested_by as requested_by_id,
  private.get_profile_name(r.requested_by) as requested_by,
  r.handled_by as handled_by_id,
  private.get_profile_name(r.handled_by) as handled_by,
  r.completed_at,
  r.updated_at

from public.armature_requests as r

join public.armatures as a
  on a.id = r.armature_id

where r.status = 'DONE';

-- ============================================================
-- 12. PERMISSIONS
-- ============================================================

revoke execute
on function public.create_armature_request(uuid, integer)
from public, anon, authenticated;

grant execute
on function public.create_armature_request(uuid, integer)
to authenticated;

revoke execute
on function public.update_request_status(uuid, public.request_status)
from public, anon, authenticated;

grant execute
on function public.update_request_status(uuid, public.request_status)
to authenticated;

revoke execute
on function public.delete_armature_request(uuid)
from public, anon, authenticated;

grant execute
on function public.delete_armature_request(uuid)
to authenticated;

revoke execute
on function public.reorder_armature_requests(uuid[])
from public, anon, authenticated;

grant execute
on function public.reorder_armature_requests(uuid[])
to authenticated;

revoke all
on table public.armature_dashboard
from public, anon;

grant select
on table public.armature_dashboard
to authenticated;

revoke all
on table public.armature_request_history
from public, anon;

grant select
on table public.armature_request_history
to authenticated;

commit;