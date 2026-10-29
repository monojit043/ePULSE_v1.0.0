-- ============================================================================
-- ePULSE production - checks on the OFFICE PIMS SERVER (run in DBeaver)
-- ePULSE reads these live, read-only, as the login named in backend\.env
-- (EMP_DB_USER / PIMS_DB_USER). Nothing below changes data; the GRANT lines
-- are only needed where a check says false.
-- Connect DBeaver to the PIMS server as a superuser (e.g. postgres).
-- Replace 'pims' below if backend\.env uses a different login.
-- ============================================================================

-- ── A. Run in ANY database ─────────────────────────────────────────────────

-- A1. The login exists and can log in
SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'pims';

-- A2. The databases exist and the login may connect (both must be true)
SELECT datname, has_database_privilege('pims', datname, 'CONNECT') AS can_connect
FROM pg_database WHERE datname IN ('eil_employees', 'pims');

-- A3. Does PostgreSQL listen on the network? ('*' or this server's IP — not 'localhost')
SHOW listen_addresses;

-- A4. Who may connect from outside (pg_hba.conf). One row must cover the APPS SERVER's IP
--     for user pims (or all) and databases eil_employees + pims (or all).
SELECT line_number, type, database, user_name, address, netmask, auth_method, error
FROM pg_hba_file_rules ORDER BY line_number;
SHOW hba_file;   -- where pg_hba.conf is on this server

-- ── B. Run while connected to database  eil_employees ──────────────────────

-- B1. The table and columns ePULSE reads (7 rows expected; department is used by SIMS / SSMS)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('id', 'name', 'password_hash', 'is_hod', 'is_active', 'created_on', 'department')
ORDER BY column_name;

-- B2. The login may read it (both true)
SELECT has_schema_privilege('pims', 'public', 'USAGE') AS schema_usage,
       CASE WHEN to_regclass('public.users') IS NOT NULL
            THEN has_table_privilege('pims', 'public.users', 'SELECT') END AS can_read_users;

-- B3. Only if B2 shows false:
-- GRANT CONNECT ON DATABASE eil_employees TO pims;
-- GRANT USAGE ON SCHEMA public TO pims;
-- GRANT SELECT ON public.users TO pims;

-- ── C. Run while connected to database  pims ───────────────────────────────

-- C1. The 5 tables ePULSE reads, with the columns it uses (every row: all_columns_present = true)
SELECT t.table_name,
       to_regclass('public.' || t.table_name) IS NOT NULL AS table_exists,
       NOT EXISTS (
         SELECT 1 FROM unnest(t.cols) c
         WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                           WHERE ic.table_schema = 'public' AND ic.table_name = t.table_name AND ic.column_name = c)
       ) AS all_columns_present,
       CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL
            THEN has_table_privilege('pims', 'public.' || t.table_name, 'SELECT') END AS can_read
FROM (VALUES
  ('projects',          ARRAY['id', 'name', 'created_by', 'created_on', 'is_active']),
  ('units',             ARRAY['id', 'project_id', 'unit_no', 'unit_name', 'parent_unit', 'is_active']),
  ('project_sgls',      ARRAY['project_id', 'user_id']),
  ('user_unit_roles',   ARRAY['user_id', 'project_id', 'unit_no', 'role_code']),
  ('role_implications', ARRAY['role_code', 'implied_role_code'])
) AS t(table_name, cols);

-- C2. Only if C1 shows can_read = false:
-- GRANT CONNECT ON DATABASE pims TO pims;
-- GRANT USAGE ON SCHEMA public TO pims;
-- GRANT SELECT ON public.projects, public.units, public.project_sgls,
--                 public.user_unit_roles, public.role_implications TO pims;
