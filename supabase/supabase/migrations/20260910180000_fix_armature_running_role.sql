begin;

-- Correct ownership of ARMATURE RUNNING updates: Gedung 1 / BOP edits,
-- while Gedung 2 / Viewer remains read-only.
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
