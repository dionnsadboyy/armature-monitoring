-- ARMATURE MONITORING SYSTEM
-- HISTORICAL BOOTSTRAP / K62 BASELINE
-- This file is not the standalone production-final definition. Apply the
-- ordered migrations in supabase/supabase/migrations/ after this baseline.
-- Reviewed: 8 September 2026
-- Quantity unit = BOX
-- 1 BOX = 18 pcs; 1 KANBAN = 6 BOX = 108 pcs
-- Historical bootstrap flow: Viewer USE -> stock -, Viewer REQUEST ->
-- PENDING -> BOP ONGOING -> DONE -> stock +. The ordered production
-- migrations supersede the DONE stock behavior with no stock mutation.
-- LOW threshold intentionally omitted (TBD).
-- DONE means material is ready/available for Gedung 2. No delivery/in-transit/received tracking.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

do $$ begin
  create type public.app_role as enum ('bop', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.armature_type as enum ('K62', 'K70');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.konmi_type as enum ('LOCAL', 'CKD');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_status as enum ('PENDING', 'ONGOING', 'DONE');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- PRIVATE HELPER SCHEMA
-- Not exposed through the Data API.
-- ============================================================

create schema if not exists private;
revoke all on schema private from public;

-- Authenticated needs schema USAGE only so security-invoker views/policies
-- can call explicitly granted helper functions in this schema.
grant usage on schema private to authenticated;

-- ============================================================
-- PROFILES / AUTH ROLE
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.get_my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
  limit 1;
$$;

revoke execute on function private.get_my_role() from public, anon, authenticated;

-- Used by dashboard view to show only the display name needed by the UI,
-- without granting direct access to every profile row.
create or replace function private.get_profile_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name
  from public.profiles as p
  where p.id = p_user_id
  limit 1;
$$;

revoke execute on function private.get_profile_name(uuid) from public, anon, authenticated;
grant execute on function private.get_profile_name(uuid) to authenticated;

-- ============================================================
-- MASTER ARMATURE
-- ============================================================

create table if not exists public.armatures (
  id uuid primary key default gen_random_uuid(),
  part_number text not null unique,
  armature_type public.armature_type not null,
  color text,
  konmi public.konmi_type,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_armatures_type
  on public.armatures (armature_type);

create index if not exists idx_armatures_active
  on public.armatures (is_active);

-- ============================================================
-- CURRENT STOCK
-- One row per armature.
-- ============================================================

create table if not exists public.armature_stock (
  armature_id uuid primary key references public.armatures(id) on delete cascade,
  quantity_box integer not null default 0 check (quantity_box >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- USAGE LOG
-- Viewer USE creates rows only through public.use_armature().
-- ============================================================

create table if not exists public.armature_usage (
  id uuid primary key default gen_random_uuid(),
  armature_id uuid not null references public.armatures(id) on delete restrict,
  quantity_box integer not null check (quantity_box > 0),
  used_by uuid not null references public.profiles(id) on delete restrict,
  used_at timestamptz not null default now()
);

create index if not exists idx_usage_armature_time
  on public.armature_usage (armature_id, used_at desc);

-- ============================================================
-- REQUESTS
-- Viewer creates PENDING; BOP moves PENDING -> ONGOING -> DONE.
-- ============================================================

create table if not exists public.armature_requests (
  id uuid primary key default gen_random_uuid(),
  armature_id uuid not null references public.armatures(id) on delete restrict,
  requested_quantity_box integer not null check (requested_quantity_box > 0),
  status public.request_status not null default 'PENDING',
  requested_by uuid not null references public.profiles(id) on delete restrict,
  handled_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint chk_request_completed_at
    check (
      (status = 'DONE' and completed_at is not null)
      or
      (status in ('PENDING', 'ONGOING') and completed_at is null)
    )
);

create index if not exists idx_requests_status
  on public.armature_requests (status);

create index if not exists idx_requests_armature
  on public.armature_requests (armature_id, requested_at desc);

-- Business rule: only one active request per armature.
create unique index if not exists uq_one_active_request_per_armature
  on public.armature_requests (armature_id)
  where status in ('PENDING', 'ONGOING');

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists trg_armatures_updated_at on public.armatures;
create trigger trg_armatures_updated_at
before update on public.armatures
for each row execute function private.set_updated_at();

drop trigger if exists trg_requests_updated_at on public.armature_requests;
create trigger trg_requests_updated_at
before update on public.armature_requests
for each row execute function private.set_updated_at();

-- ============================================================
-- AUTH USER -> PROFILE
-- New Auth users default to Viewer. BOP promotion is done manually by
-- a trusted operator in the Supabase SQL Editor / Dashboard.
-- ============================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'viewer'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Backfill profiles for Auth users that may already exist when this SQL runs.
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.email),
  'viewer'::public.app_role
from auth.users as u
on conflict (id) do nothing;

-- ============================================================
-- RPC: VIEWER USE ARMATURE
-- Atomic: validates -> stock decrement -> usage log.
-- ============================================================

create or replace function public.use_armature(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock public.armature_stock;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'viewer'::public.app_role then
    raise exception 'Only Viewer can use armature';
  end if;

  if p_quantity_box is null or p_quantity_box <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;

  if not exists (
    select 1
    from public.armatures as a
    where a.id = p_armature_id
      and a.is_active = true
  ) then
    raise exception 'Armature not found or inactive';
  end if;

  update public.armature_stock
  set quantity_box = quantity_box - p_quantity_box,
      updated_by = auth.uid(),
      updated_at = now()
  where armature_id = p_armature_id
    and quantity_box >= p_quantity_box
  returning * into v_stock;

  if not found then
    raise exception 'Insufficient stock';
  end if;

  insert into public.armature_usage (armature_id, quantity_box, used_by)
  values (p_armature_id, p_quantity_box, auth.uid());

  return v_stock;
end;
$$;

-- ============================================================
-- RPC: VIEWER CREATE REQUEST
-- One active request per armature is also guaranteed by a unique index.
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

  insert into public.armature_requests (
    armature_id,
    requested_quantity_box,
    requested_by
  )
  values (
    p_armature_id,
    p_quantity_box,
    auth.uid()
  )
  returning * into v_request;

  return v_request;

exception
  when unique_violation then
    raise exception 'This armature already has an active request';
end;
$$;

-- ============================================================
-- RPC: BOP UPDATE REQUEST STATUS
-- Allowed transitions only:
-- PENDING -> ONGOING
-- ONGOING -> DONE
-- Historical bootstrap behavior: DONE added requested BOX to stock. The
-- ordered production migrations supersede this function with DONE-only state
-- transition and no stock mutation.
-- ============================================================

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
    set status = 'ONGOING',
        handled_by = auth.uid()
    where id = p_request_id
    returning * into v_request;

    return v_request;
  end if;

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
    set status = 'DONE',
        handled_by = auth.uid(),
        completed_at = now()
    where id = p_request_id
    returning * into v_request;

    return v_request;
  end if;

  raise exception 'Unsupported status transition';
end;
$$;

-- ============================================================
-- RPC: BOP MANUAL ACTUAL-STOCK UPDATE
-- Sets the current stock to an absolute BOX quantity.
-- ============================================================

create or replace function public.update_armature_stock(
  p_armature_id uuid,
  p_quantity_box integer
)
returns public.armature_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock public.armature_stock;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can update stock';
  end if;

  if p_quantity_box is null or p_quantity_box < 0 then
    raise exception 'Quantity cannot be negative';
  end if;

  if not exists (
    select 1
    from public.armatures as a
    where a.id = p_armature_id
      and a.is_active = true
  ) then
    raise exception 'Armature not found or inactive';
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
    now()
  )
  on conflict (armature_id)
  do update set
    quantity_box = excluded.quantity_box,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_stock;

  return v_stock;
end;
$$;

-- ============================================================
-- RPC EXECUTE PRIVILEGES
-- PostgreSQL grants EXECUTE to PUBLIC by default, so revoke explicitly.
-- ============================================================

revoke execute on function public.use_armature(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.create_armature_request(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.update_request_status(uuid, public.request_status)
  from public, anon, authenticated;
revoke execute on function public.update_armature_stock(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.use_armature(uuid, integer)
  to authenticated;
grant execute on function public.create_armature_request(uuid, integer)
  to authenticated;
grant execute on function public.update_request_status(uuid, public.request_status)
  to authenticated;
grant execute on function public.update_armature_stock(uuid, integer)
  to authenticated;

-- ============================================================
-- RLS
-- Direct client writes are intentionally NOT allowed.
-- All critical writes happen through the RPC functions above.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.armatures enable row level security;
alter table public.armature_stock enable row level security;
alter table public.armature_usage enable row level security;
alter table public.armature_requests enable row level security;

-- Profile: each authenticated user can read only their own profile/role.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() is not null and id = auth.uid());

-- Armature master: authenticated users read active materials only.
drop policy if exists "armatures_select_authenticated" on public.armatures;
create policy "armatures_select_authenticated"
on public.armatures
for select
to authenticated
using (is_active = true);

-- Stock: read only for authenticated users.
drop policy if exists "stock_select_authenticated" on public.armature_stock;
create policy "stock_select_authenticated"
on public.armature_stock
for select
to authenticated
using (true);

-- Remove older direct-write policies if this script is run over v1.
drop policy if exists "stock_insert_bop" on public.armature_stock;
drop policy if exists "stock_update_bop" on public.armature_stock;
drop policy if exists "stock_delete_bop" on public.armature_stock;

drop policy if exists "armatures_insert_bop" on public.armatures;
drop policy if exists "armatures_update_bop" on public.armatures;
drop policy if exists "armatures_delete_bop" on public.armatures;

-- Usage log: read only. Insert occurs through use_armature().
drop policy if exists "usage_select_authenticated" on public.armature_usage;
create policy "usage_select_authenticated"
on public.armature_usage
for select
to authenticated
using (true);

-- Requests: both Viewer and BOP can read. Writes occur only through RPC.
drop policy if exists "requests_select_authenticated" on public.armature_requests;
create policy "requests_select_authenticated"
on public.armature_requests
for select
to authenticated
using (true);

-- ============================================================
-- K62 VERIFIED MASTER DATA
-- A:0280 color/Konmi intentionally remains NULL until verified.
-- ============================================================

insert into public.armatures
  (part_number, armature_type, color, konmi, is_active)
values
  ('A:0121', 'K62', 'Biru',   'LOCAL', true),
  ('A:0130', 'K62', 'Merah',  'CKD',   true),
  ('A:0131', 'K62', 'Merah',  'LOCAL', true),
  ('A:0140', 'K62', 'Hijau',  'CKD',   true),
  ('A:0141', 'K62', 'Hijau',  'LOCAL', true),
  ('A:0152', 'K62', 'Kuning', 'LOCAL', true),
  ('A:0220', 'K62', 'Biru',   'CKD',   true),
  ('A:0280', 'K62', null,     null,    true),
  ('A:0290', 'K62', 'Hitam',  'LOCAL', true)
on conflict (part_number) do update set
  armature_type = excluded.armature_type,
  color = coalesce(excluded.color, public.armatures.color),
  konmi = coalesce(excluded.konmi, public.armatures.konmi),
  is_active = true,
  updated_at = now();

-- Initialize K62 stock at 0 BOX without overwriting existing actual stock.
insert into public.armature_stock (armature_id, quantity_box)
select a.id, 0
from public.armatures as a
where a.armature_type = 'K62'
on conflict (armature_id) do nothing;

-- ============================================================
-- DASHBOARD VIEW
-- Security invoker keeps underlying RLS in force.
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
  private.get_profile_name(r.handled_by) as handled_by
from public.armatures as a
left join public.armature_stock as s
  on s.armature_id = a.id
left join public.armature_requests as r
  on r.armature_id = a.id
 and r.status in ('PENDING', 'ONGOING')
where a.is_active = true;

-- ============================================================
-- DATA API PRIVILEGES - LEAST PRIVILEGE
-- Authenticated can read; anon cannot read project data.
-- Frontend mutation is RPC-only.
-- ============================================================

revoke all privileges on table public.profiles
  from anon, authenticated;
revoke all privileges on table public.armatures
  from anon, authenticated;
revoke all privileges on table public.armature_stock
  from anon, authenticated;
revoke all privileges on table public.armature_usage
  from anon, authenticated;
revoke all privileges on table public.armature_requests
  from anon, authenticated;
revoke all privileges on table public.armature_dashboard
  from anon, authenticated;

grant select on table public.profiles
  to authenticated;
grant select on table public.armatures
  to authenticated;
grant select on table public.armature_stock
  to authenticated;
grant select on table public.armature_usage
  to authenticated;
grant select on table public.armature_requests
  to authenticated;
grant select on table public.armature_dashboard
  to authenticated;

commit;

-- END OF MVP SQL
