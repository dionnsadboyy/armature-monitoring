begin;

-- Stock movement is an append-only record of each successful stock mutation.
-- quantity_changed is signed: USE is negative, STOCK_UPDATE is the absolute
-- stock difference (positive or negative).
create table if not exists public.armature_stock_movements (
  id uuid primary key default gen_random_uuid(),
  armature_id uuid not null references public.armatures(id) on delete restrict,
  movement_type text not null check (movement_type in ('USE', 'STOCK_UPDATE')),
  stock_before integer not null check (stock_before >= 0),
  quantity_changed integer not null,
  stock_after integer not null check (stock_after >= 0),
  performed_by uuid not null references public.profiles(id) on delete restrict,
  performed_at timestamptz not null default now()
);

create index if not exists idx_armature_stock_movements_latest
  on public.armature_stock_movements (armature_id, performed_at desc, id desc);

alter table public.armature_stock_movements enable row level security;

drop policy if exists "stock_movements_select_authenticated"
  on public.armature_stock_movements;

create policy "stock_movements_select_authenticated"
on public.armature_stock_movements
for select
to authenticated
using (true);

revoke all on table public.armature_stock_movements
from public, anon, authenticated;

grant select on table public.armature_stock_movements to authenticated;

-- USE/HARVEST: lock the current stock row, mutate it, then append the
-- movement in the same transaction.
create or replace function public.use_armature(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_stock
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stock public.armature_stock;
  v_stock_before integer;
  v_performed_at timestamptz := now();
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can use armature';
  end if;

  if p_quantity_box is null or p_quantity_box <= 0 then
    raise exception 'Usage quantity must be greater than 0';
  end if;

  if not exists (
    select 1
    from public.armatures
    where id = p_armature_id
      and is_active = true
  ) then
    raise exception 'Armature not found or inactive';
  end if;

  select *
  into v_stock
  from public.armature_stock
  where armature_id = p_armature_id
  for update;

  if not found then
    raise exception 'Stock record not found';
  end if;

  v_stock_before := v_stock.quantity_box;

  if v_stock_before < p_quantity_box then
    raise exception 'Insufficient stock';
  end if;

  update public.armature_stock
  set
    quantity_box = v_stock_before - p_quantity_box,
    updated_by = auth.uid(),
    updated_at = v_performed_at
  where armature_id = p_armature_id
  returning * into v_stock;

  insert into public.armature_usage (
    armature_id,
    quantity_box,
    used_by,
    used_at
  )
  values (
    p_armature_id,
    p_quantity_box,
    auth.uid(),
    v_performed_at
  );

  insert into public.armature_stock_movements (
    armature_id,
    movement_type,
    stock_before,
    quantity_changed,
    stock_after,
    performed_by,
    performed_at
  )
  values (
    p_armature_id,
    'USE',
    v_stock_before,
    -p_quantity_box,
    v_stock.quantity_box,
    auth.uid(),
    v_performed_at
  );

  return v_stock;
end;
$function$;

-- Manual BOP stock update: the input is the new absolute stock value; the
-- movement stores the signed difference from the previous value.
create or replace function public.update_armature_stock(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_stock
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stock public.armature_stock;
  v_stock_before integer;
  v_performed_at timestamptz := now();
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can update stock';
  end if;

  if p_quantity_box is null or p_quantity_box < 0 then
    raise exception 'Stock quantity cannot be negative';
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

  select quantity_box
  into v_stock_before
  from public.armature_stock
  where armature_id = p_armature_id
  for update;

  if not found then
    v_stock_before := 0;
  end if;

  insert into public.armature_stock (
    armature_id,
    quantity_box,
    updated_by,
    updated_at
  )
  values (
    p_armature_id,
    p_quantity_box,
    auth.uid(),
    v_performed_at
  )
  on conflict (armature_id)
  do update set
    quantity_box = excluded.quantity_box,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into v_stock;

  insert into public.armature_stock_movements (
    armature_id,
    movement_type,
    stock_before,
    quantity_changed,
    stock_after,
    performed_by,
    performed_at
  )
  values (
    p_armature_id,
    'STOCK_UPDATE',
    v_stock_before,
    p_quantity_box - v_stock_before,
    v_stock.quantity_box,
    auth.uid(),
    v_performed_at
  );

  return v_stock;
end;
$function$;

-- DONE changes request state only. It must not change physical stock.
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
     or private.get_my_role() is distinct from 'bop'::public.app_role then
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

  if p_status = 'ONGOING' then
    if v_request.status <> 'PENDING' then
      raise exception 'Only PENDING request can become ONGOING';
    end if;

    update public.armature_requests
    set status = 'ONGOING', handled_by = auth.uid()
    where id = p_request_id
    returning * into v_request;

    return v_request;
  end if;

  if p_status = 'DONE' then
    if v_request.status <> 'ONGOING' then
      raise exception 'Only ONGOING request can become DONE';
    end if;

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

-- Expose only the latest stock movement for the existing material-card query.
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
    when coalesce(s.quantity_box, 0) = 0 then 'EMPTY'
    else 'READY'
  end as stock_status,
  s.updated_at as last_stock_update,
  s.updated_by as stock_updated_by_id,
  private.get_profile_name(s.updated_by) as stock_updated_by,
  m.movement_type as last_movement_type,
  m.stock_before as last_movement_stock_before,
  m.quantity_changed as last_movement_quantity_changed,
  m.stock_after as last_movement_stock_after,
  m.performed_at as last_movement_at,
  m.performed_by as last_movement_performed_by_id,
  private.get_profile_name(m.performed_by) as last_movement_performed_by,
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
left join lateral (
  select sm.*
  from public.armature_stock_movements as sm
  where sm.armature_id = a.id
  order by sm.performed_at desc, sm.id desc
  limit 1
) as m on true
left join public.armature_requests as r
  on r.armature_id = a.id
 and r.status in ('PENDING', 'ONGOING')
where a.is_active = true;

revoke execute on function public.use_armature(uuid, integer)
from public, anon, authenticated;
grant execute on function public.use_armature(uuid, integer) to authenticated;

revoke execute on function public.update_armature_stock(uuid, integer)
from public, anon, authenticated;
grant execute on function public.update_armature_stock(uuid, integer) to authenticated;

revoke execute on function public.update_request_status(uuid, public.request_status)
from public, anon, authenticated;
grant execute on function public.update_request_status(uuid, public.request_status) to authenticated;

revoke all on table public.armature_dashboard from public, anon;
grant select on table public.armature_dashboard to authenticated;

commit;
