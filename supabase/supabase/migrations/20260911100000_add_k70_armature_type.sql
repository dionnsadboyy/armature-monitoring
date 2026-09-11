-- Catch-up migration: make the final K70 enum value available before any
-- following migration uses it in typed literals.
-- Safe to rerun when K70 is already present.

do $$
begin
  if to_regtype('public.armature_type') is null then
    raise exception 'Required type public.armature_type does not exist';
  end if;

  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'public.armature_type'::regtype
      and enumlabel = 'K70'
  ) then
    alter type public.armature_type add value 'K70';
  end if;
end
$$;
