-- ARMATURE MONITORING SYSTEM
-- Post-install checks (read-only)
-- Run AFTER the bootstrap SQL and ordered migrations (read-only).

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

-- 5) Verify the exact final K70 master data.
select part_number, armature_type, color, konmi, is_active
from public.armatures
where armature_type = 'K70'
order by part_number;

-- 6) K70 should have 8 stock rows; this query must not mutate stock.
select
  count(*) as k70_stock_row_count,
  sum(quantity_box) as k70_total_box
from public.armature_stock s
join public.armatures a on a.id = s.armature_id
where a.armature_type = 'K70';

-- 7) Confirm the one-active-request partial unique index.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'uq_one_active_request_per_armature';

-- 8) Confirm RLS is enabled on every exposed base table.
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
    'armature_requests',
    'armature_running'
  )
order by c.relname;

-- 9) Confirm only SELECT RLS policies exist for direct table access.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'armatures',
    'armature_stock',
    'armature_usage',
    'armature_requests',
    'armature_running'
  )
order by tablename, policyname;

-- 10) Anon must NOT be able to execute critical RPCs.
select
  has_function_privilege('anon', 'public.use_armature(uuid,integer)', 'EXECUTE')
    as anon_use_armature,
  has_function_privilege('anon', 'public.create_armature_request(uuid,integer)', 'EXECUTE')
    as anon_create_request,
  has_function_privilege('anon', 'public.update_request_status(uuid,public.request_status)', 'EXECUTE')
    as anon_update_request,
  has_function_privilege('anon', 'public.update_armature_stock(uuid,integer)', 'EXECUTE')
    as anon_update_stock,
  has_function_privilege('anon', 'public.update_armature_running(text,boolean,uuid)', 'EXECUTE')
    as anon_update_running;

-- Expected: all FALSE.

-- 11) Authenticated users must be able to execute critical RPCs.
select
  has_function_privilege('authenticated', 'public.use_armature(uuid,integer)', 'EXECUTE')
    as auth_use_armature,
  has_function_privilege('authenticated', 'public.create_armature_request(uuid,integer)', 'EXECUTE')
    as auth_create_request,
  has_function_privilege('authenticated', 'public.update_request_status(uuid,public.request_status)', 'EXECUTE')
    as auth_update_request,
  has_function_privilege('authenticated', 'public.update_armature_stock(uuid,integer)', 'EXECUTE')
    as auth_update_stock,
  has_function_privilege('authenticated', 'public.update_armature_running(text,boolean,uuid)', 'EXECUTE')
    as auth_update_running;

-- Expected: all TRUE. Role checks inside the RPC still decide Viewer vs BOP.

-- 12) Authenticated direct table writes must be blocked at privilege level.
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

-- 13) Dashboard view should be security_invoker.
select
  n.nspname as schema_name,
  c.relname as view_name,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'armature_dashboard';

-- Expected reloptions includes security_invoker=true.

-- 14) Dashboard smoke check as SQL admin.
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

-- 15) DEV-only pending request-order checks.
-- Expected active rows: sequence starts at 1, has no duplicates, and has no gaps.
with active_requests as (
  select request_sequence
  from public.armature_requests
  where status = 'PENDING'
)
select
  count(*) as active_request_count,
  count(distinct request_sequence) as distinct_sequence_count,
  coalesce(min(request_sequence), 0) as min_sequence,
  coalesce(max(request_sequence), 0) as max_sequence,
  count(*) = count(distinct request_sequence)
    and (count(*) = 0 or (min(request_sequence) = 1 and max(request_sequence) = count(*)))
    as sequence_is_contiguous
from active_requests;

-- 16) Dashboard must expose the persisted sequence for pending requests.
select part_number, active_request_status, request_sequence
from public.armature_dashboard
where active_request_id is not null
order by request_sequence asc nulls last, active_request_at asc, id asc;

-- 17) DONE history must be newest completed request first.
select part_number, requested_quantity_box, status, completed_at, handled_by
from public.armature_request_history
order by completed_at desc, id desc;

-- 18) Only authenticated callers receive RPC access; the RPC itself limits
-- execution to Viewer through its role check.
select
  has_function_privilege('anon', 'public.reorder_armature_requests(uuid[])', 'EXECUTE')
    as anon_reorder_requests,
  has_function_privilege('authenticated', 'public.reorder_armature_requests(uuid[])', 'EXECUTE')
    as authenticated_reorder_requests;

-- Expected: anon_reorder_requests = FALSE; authenticated_reorder_requests = TRUE.

-- 19) Delete RPC is authenticated-only; its BOP/status checks are inside RPC.
select
  has_function_privilege('anon', 'public.delete_armature_request(uuid)', 'EXECUTE')
    as anon_delete_request,
  has_function_privilege('authenticated', 'public.delete_armature_request(uuid)', 'EXECUTE')
    as authenticated_delete_request;

-- 20) Final running machine codes and machine-down invariant.
select machine_code, is_machine_down, armature_id
from public.armature_running
order by machine_code;

select conname, pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid = 'public.armature_running'::regclass
  and conname in (
    'armature_running_machine_code_check',
    'armature_running_down_has_no_armature'
  )
order by conname;
