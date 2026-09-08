-- ARMATURE MONITORING SYSTEM
-- Post-install checks (read-only)
-- Run AFTER armature_monitoring_supabase_mvp_k62_v2_safe.sql

-- 1) K62 master should contain exactly 9 rows.
select count(*) as k62_master_count
from public.armatures
where armature_type = 'K62';

-- 2) Verify the exact K62 master data.
select part_number, armature_type, color, konmi, is_active
from public.armatures
where armature_type = 'K62'
order by part_number;

-- 3) A:0280 must still be unknown/null for color and konmi.
select part_number, color, konmi
from public.armatures
where part_number = 'A:0280';

-- 4) Initial stock rows should exist for all 9 K62 armatures.
select
  count(*) as stock_row_count,
  sum(quantity_box) as total_initial_box
from public.armature_stock s
join public.armatures a on a.id = s.armature_id
where a.armature_type = 'K62';

-- 5) Confirm the one-active-request partial unique index.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'uq_one_active_request_per_armature';

-- 6) Confirm RLS is enabled on every exposed base table.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'armatures',
    'armature_stock',
    'armature_usage',
    'armature_requests'
  )
order by c.relname;

-- 7) Confirm only SELECT RLS policies exist for direct table access.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'armatures',
    'armature_stock',
    'armature_usage',
    'armature_requests'
  )
order by tablename, policyname;

-- 8) Anon must NOT be able to execute critical RPCs.
select
  has_function_privilege('anon', 'public.use_armature(uuid,integer)', 'EXECUTE')
    as anon_use_armature,
  has_function_privilege('anon', 'public.create_armature_request(uuid,integer)', 'EXECUTE')
    as anon_create_request,
  has_function_privilege('anon', 'public.update_request_status(uuid,public.request_status)', 'EXECUTE')
    as anon_update_request,
  has_function_privilege('anon', 'public.update_armature_stock(uuid,integer)', 'EXECUTE')
    as anon_update_stock;

-- Expected: all FALSE.

-- 9) Authenticated users must be able to execute critical RPCs.
select
  has_function_privilege('authenticated', 'public.use_armature(uuid,integer)', 'EXECUTE')
    as auth_use_armature,
  has_function_privilege('authenticated', 'public.create_armature_request(uuid,integer)', 'EXECUTE')
    as auth_create_request,
  has_function_privilege('authenticated', 'public.update_request_status(uuid,public.request_status)', 'EXECUTE')
    as auth_update_request,
  has_function_privilege('authenticated', 'public.update_armature_stock(uuid,integer)', 'EXECUTE')
    as auth_update_stock;

-- Expected: all TRUE. Role checks inside the RPC still decide Viewer vs BOP.

-- 10) Authenticated direct table writes must be blocked at privilege level.
select
  has_table_privilege('authenticated', 'public.armature_stock', 'SELECT') as stock_select,
  has_table_privilege('authenticated', 'public.armature_stock', 'INSERT') as stock_insert,
  has_table_privilege('authenticated', 'public.armature_stock', 'UPDATE') as stock_update,
  has_table_privilege('authenticated', 'public.armature_stock', 'DELETE') as stock_delete,
  has_table_privilege('authenticated', 'public.armature_requests', 'INSERT') as request_insert,
  has_table_privilege('authenticated', 'public.armature_requests', 'UPDATE') as request_update;

-- Expected:
-- stock_select = TRUE
-- stock_insert/update/delete = FALSE
-- request_insert/update = FALSE

-- 11) Dashboard view should be security_invoker.
select
  n.nspname as schema_name,
  c.relname as view_name,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'armature_dashboard';

-- Expected reloptions includes security_invoker=true.

-- 12) Dashboard smoke check as SQL admin.
select
  part_number,
  armature_type,
  color,
  konmi,
  quantity_box,
  stock_status,
  active_request_status
from public.armature_dashboard
order by part_number;
