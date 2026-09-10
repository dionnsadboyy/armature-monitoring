begin;

-- One current state row per production machine. Normal + no armature is
-- allowed as the initial state; machine down + running armature is not.
create table if not exists public.armature_running (
  machine_code text primary key
    check (machine_code in ('MODULE', 'TRANSFER_LINE')),
  is_machine_down boolean not null default false,
  armature_id uuid references public.armatures(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint armature_running_down_has_no_armature
    check (not is_machine_down or armature_id is null)
);

create index if not exists idx_armature_running_armature_id
  on public.armature_running (armature_id)
  where armature_id is not null;

insert into public.armature_running (machine_code)
values ('MODULE'), ('TRANSFER_LINE')
on conflict (machine_code) do nothing;

alter table public.armature_running enable row level security;

drop policy if exists "armature_running_select_authenticated"
  on public.armature_running;

create policy "armature_running_select_authenticated"
on public.armature_running
for select
to authenticated
using (true);

revoke all on table public.armature_running
from public, anon, authenticated;

grant select on table public.armature_running to authenticated;

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
  v_armature_id uuid;
  v_state public.armature_running;
begin
  if auth.uid() is null
     or private.get_my_role() is distinct from 'bop'::public.app_role then
    raise exception 'Only BOP can update armature running';
  end if;

  if v_machine_code is null
     or v_machine_code not in ('MODULE', 'TRANSFER_LINE') then
    raise exception 'Unknown machine';
  end if;

  if p_machine_down is null then
    raise exception 'Machine condition is required';
  end if;

  -- A down machine always clears the running armature in the same statement.
  v_armature_id := case when p_machine_down then null else p_armature_id end;

  if v_armature_id is not null and not exists (
    select 1
    from public.armatures
    where id = v_armature_id
      and armature_type = 'K62'::public.armature_type
      and is_active = true
  ) then
    raise exception 'Armature not found or inactive';
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
    updated_at = excluded.updated_at
  returning * into v_state;

  return v_state;
end;
$function$;

revoke execute on function public.update_armature_running(text, boolean, uuid)
from public, anon, authenticated;

grant execute on function public.update_armature_running(text, boolean, uuid)
to authenticated;

commit;
