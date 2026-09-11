begin;

-- ============================================================
-- K70 PRODUCTION CATCH-UP
--
-- This migration records the production changes that were previously
-- applied manually. It is deliberately forward-only and does not rewrite
-- K62 rows or overwrite any existing K70 stock.
-- ============================================================

do $$
begin
  if to_regclass('public.armatures') is null then
    raise exception 'Required table public.armatures does not exist';
  end if;

  if to_regclass('public.armature_stock') is null then
    raise exception 'Required table public.armature_stock does not exist';
  end if;

  if to_regclass('public.armature_running') is null then
    raise exception 'Required table public.armature_running does not exist';
  end if;
end
$$;

-- Fail loudly if an environment still contains the obsolete K70 master
-- codes. Do not silently delete or rename real rows from a migration.
do $$
begin
  if exists (
    select 1
    from public.armatures
    where armature_type = 'K70'::public.armature_type
      and part_number in (
        'A:0002', 'A:0012', 'A:0052', 'A:0072',
        'A:0082', 'A:0142', 'A:0260', 'A:0520'
      )
  ) then
    raise exception 'Obsolete K70 master code exists; review it manually before applying this migration';
  end if;
end
$$;

-- Existing rows with a final part number must already match the source of
-- truth exactly. Conflicts are not overwritten.
do $$
declare
  v_expected record;
  v_existing public.armatures%rowtype;
begin
  for v_expected in
    select *
    from (values
      ('A:5002', 'K70', 'Biru',   'LOCAL', true),
      ('A:5012', 'K70', 'Merah',  'LOCAL', true),
      ('A:5052', 'K70', 'Kuning', 'LOCAL', true),
      ('A:5072', 'K70', 'Hijau',  'LOCAL', true),
      ('A:5082', 'K70', 'Hitam',  'LOCAL', true),
      ('A:5142', 'K70', 'Pink',   'LOCAL', true),
      ('A:5250', 'K70', 'Orange', 'LOCAL', true),
      ('A:5260', 'K70', 'Ungu',   'LOCAL', true)
    ) as expected(part_number, armature_type, color, konmi, is_active)
  loop
    select *
    into v_existing
    from public.armatures
    where part_number = v_expected.part_number;

    if found and (
      v_existing.armature_type::text is distinct from v_expected.armature_type
      or v_existing.color is distinct from v_expected.color
      or v_existing.konmi::text is distinct from v_expected.konmi
      or v_existing.is_active is distinct from v_expected.is_active
    ) then
      raise exception 'K70 master conflict for part_number %; existing row was not changed', v_expected.part_number;
    end if;
  end loop;

  if exists (
    select 1
    from public.armatures
    where armature_type = 'K70'::public.armature_type
      and part_number not in (
        'A:5002', 'A:5012', 'A:5052', 'A:5072',
        'A:5082', 'A:5142', 'A:5250', 'A:5260'
      )
  ) then
    raise exception 'Unexpected K70 master row exists; review it manually before applying this migration';
  end if;
end
$$;

-- Insert missing final K70 master rows only. Existing matching rows are
-- preserved and existing conflicts have already failed above.
insert into public.armatures
  (part_number, armature_type, color, konmi, is_active)
values
  ('A:5002', 'K70', 'Biru',   'LOCAL', true),
  ('A:5012', 'K70', 'Merah',  'LOCAL', true),
  ('A:5052', 'K70', 'Kuning', 'LOCAL', true),
  ('A:5072', 'K70', 'Hijau',  'LOCAL', true),
  ('A:5082', 'K70', 'Hitam',  'LOCAL', true),
  ('A:5142', 'K70', 'Pink',   'LOCAL', true),
  ('A:5250', 'K70', 'Orange', 'LOCAL', true),
  ('A:5260', 'K70', 'Ungu',   'LOCAL', true)
on conflict (part_number) do nothing;

-- Initialize only missing stock rows. Existing stock quantities are never
-- updated or reset by this migration.
insert into public.armature_stock (armature_id, quantity_box)
select a.id, 0
from (values
  ('A:5002'), ('A:5012'), ('A:5052'), ('A:5072'),
  ('A:5082'), ('A:5142'), ('A:5250'), ('A:5260')
) as expected(part_number)
join public.armatures as a
  on a.part_number = expected.part_number
 and a.armature_type = 'K70'::public.armature_type
on conflict (armature_id) do nothing;

-- The original running migration created a K62-only check. Expand only the
-- machine-code constraint after validating that no unknown current code is
-- present. K62 rows and their values remain untouched.
do $$
declare
  v_constraint record;
begin
  if exists (
    select 1
    from public.armature_running
    where machine_code not in (
      'MODULE', 'TRANSFER_LINE', 'MODULE_K70', 'TRANSFER_LINE_K70'
    )
  ) then
    raise exception 'Unknown armature_running machine_code exists; existing rows were not changed';
  end if;

  if not exists (
    select 1
    from pg_constraint as c
    where c.conrelid = 'public.armature_running'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%MODULE%'
      and pg_get_constraintdef(c.oid) ilike '%TRANSFER_LINE%'
      and pg_get_constraintdef(c.oid) ilike '%MODULE_K70%'
      and pg_get_constraintdef(c.oid) ilike '%TRANSFER_LINE_K70%'
  ) then
    for v_constraint in
      select c.conname
      from pg_constraint as c
      where c.conrelid = 'public.armature_running'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%machine_code%'
    loop
      execute format(
        'alter table public.armature_running drop constraint %I',
        v_constraint.conname
      );
    end loop;

    alter table public.armature_running
      add constraint armature_running_machine_code_check
      check (machine_code in (
        'MODULE', 'TRANSFER_LINE', 'MODULE_K70', 'TRANSFER_LINE_K70'
      ));
  end if;
end
$$;

-- Preserve the existing machine-down invariant if this catch-up is applied
-- to a partially prepared environment.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'armature_running_down_has_no_armature'
      and conrelid = 'public.armature_running'::regclass
  ) then
    alter table public.armature_running
      add constraint armature_running_down_has_no_armature
      check (not is_machine_down or armature_id is null);
  end if;
end
$$;

-- Add only the missing K70 state rows. Existing MODULE/TRANSFER_LINE K62
-- rows and any existing K70 state values are preserved.
insert into public.armature_running (machine_code)
values ('MODULE_K70'), ('TRANSFER_LINE_K70')
on conflict (machine_code) do nothing;

-- Final BOP-only RPC. The database machine code is intentionally distinct
-- from the UI label used by the frontend.
create or replace function public.update_armature_running(
  p_machine_code text,
  p_machine_down boolean,
  p_armature_id uuid default null
)
returns public.armature_running
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_machine_code text := upper(trim(p_machine_code));
  v_required_type public.armature_type;
  v_armature_id uuid;
  v_state public.armature_running;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can update armature running';
  end if;

  case v_machine_code
    when 'MODULE' then
      v_required_type := 'K62'::public.armature_type;
    when 'TRANSFER_LINE' then
      v_required_type := 'K62'::public.armature_type;
    when 'MODULE_K70' then
      v_required_type := 'K70'::public.armature_type;
    when 'TRANSFER_LINE_K70' then
      v_required_type := 'K70'::public.armature_type;
    else
      raise exception 'Unknown machine';
  end case;

  if p_machine_down is null then
    raise exception 'Machine condition is required';
  end if;

  v_armature_id := case when p_machine_down then null else p_armature_id end;

  if v_armature_id is not null and not exists (
    select 1
    from public.armatures
    where id = v_armature_id
      and armature_type = v_required_type
      and is_active = true
  ) then
    raise exception 'Armature not found, inactive, or wrong type';
  end if;

  insert into public.armature_running (
    machine_code,
    is_machine_down,
    armature_id,
    updated_by,
    updated_at
  )
  values (
    v_machine_code,
    p_machine_down,
    v_armature_id,
    auth.uid(),
    now()
  )
  on conflict (machine_code)
  do update set
    is_machine_down = excluded.is_machine_down,
    armature_id = excluded.armature_id,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_state;

  return v_state;
end;
$function$;

revoke execute
on function public.update_armature_running(text, boolean, uuid)
from public, anon, authenticated;

grant execute
on function public.update_armature_running(text, boolean, uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
