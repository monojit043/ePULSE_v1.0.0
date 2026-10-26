// Links the ePULSE DB to the master DBs on PC-2 with postgres_fdw — LIVE, nothing is copied.
//
//   eil_employees  → schema pc2_emp   (foreign table: users)
//   cmp_pims_1014  → schema pc2_pims  (foreign tables: projects, units, project_sgls,
//                                       user_unit_roles, role_implications)
//
// The local tables users, projects, project_units, project_sgls, user_role_assignments and
// master_units (from PIMS units.parent_unit) are replaced by read-only VIEWS of the same name
// and columns, so existing queries keep working but every read goes to PC-2. Foreign keys that pointed at those tables are dropped
// (PostgreSQL can't enforce a FK against another database).
//
// Run once per machine:  npm run db:link-pc2   (safe to re-run; it rebuilds everything)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

// Password from .env, else from %APPDATA%\postgresql\pgpass.conf (same rules as psql)
function resolvePassword(prefix) {
  const fromEnv = process.env[`${prefix}_PASSWORD`];
  if (fromEnv) return fromEnv;
  const host = process.env[`${prefix}_HOST`], port = process.env[`${prefix}_PORT`] || "5432";
  const db = process.env[`${prefix}_NAME`], user = process.env[`${prefix}_USER`] || "postgres";
  const file = process.env.PGPASSFILE || path.join(process.env.APPDATA || "", "postgresql", "pgpass.conf");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const f = line.split(/(?<!\\):/).map((s) => s.replace(/\\([:\\])/g, "$1"));
      if (f.length < 5) continue;
      const ok = (v, want) => v === "*" || v === want;
      if (ok(f[0], host) && ok(f[1], port) && ok(f[2], db) && ok(f[3], user)) return f.slice(4).join(":");
    }
  }
  throw new Error(`No password for ${user}@${host}/${db} — set ${prefix}_PASSWORD in .env or add it to ${file}`);
}

function serverConfig(prefix) {
  return {
    host: process.env[`${prefix}_HOST`],
    port: process.env[`${prefix}_PORT`] || "5432",
    dbname: process.env[`${prefix}_NAME`],
    user: process.env[`${prefix}_USER`] || "postgres",
    password: resolvePassword(prefix),
  };
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function serverSql(name, c) {
  return `
    CREATE SERVER ${name} FOREIGN DATA WRAPPER postgres_fdw
      OPTIONS (host ${lit(c.host)}, port ${lit(c.port)}, dbname ${lit(c.dbname)}, connect_timeout '10');
    CREATE USER MAPPING FOR CURRENT_USER SERVER ${name}
      OPTIONS (user ${lit(c.user)}, password ${lit(c.password)});`;
}

// DRY_RUN=1 runs every step, prints the live counts, then rolls back — nothing is changed
const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const emp = serverConfig("EMP_DB");
  const pims = serverConfig("PIMS_DB");
  console.log(`Linking ePULSE (${process.env.DB_NAME}) to PC-2 ${emp.host}${DRY_RUN ? " — DRY RUN, will roll back" : ""}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("  1/4 creating links and foreign tables...");
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;

      -- Rebuild links from scratch (CASCADE also drops the views built on them)
      DROP SCHEMA IF EXISTS pc2_emp CASCADE;
      DROP SCHEMA IF EXISTS pc2_pims CASCADE;
      DROP SERVER IF EXISTS pc2_employees CASCADE;
      DROP SERVER IF EXISTS pc2_pims CASCADE;
      ${serverSql("pc2_employees", emp)}
      ${serverSql("pc2_pims", pims)}

      CREATE SCHEMA pc2_emp;
      CREATE SCHEMA pc2_pims;
      IMPORT FOREIGN SCHEMA public LIMIT TO (users)
        FROM SERVER pc2_employees INTO pc2_emp;
      IMPORT FOREIGN SCHEMA public LIMIT TO (projects, units, project_sgls, user_unit_roles, role_implications)
        FROM SERVER pc2_pims INTO pc2_pims;
    `);

    // Old local copies (first run only). CASCADE drops the FKs other tables had on them.
    console.log("  2/4 removing old local copies...");
    const { rows: oldTables } = await client.query(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
         AND relname = ANY($1)`,
      [["users", "projects", "project_units", "project_sgls", "user_role_assignments", "master_units"]]
    );
    for (const { relname } of oldTables) {
      await client.query(`DROP TABLE public.${relname} CASCADE`);
      console.log(`  dropped local table ${relname}`);
    }

    console.log("  3/4 creating live views...");
    await client.query(`
      DROP VIEW IF EXISTS public.users, public.projects, public.project_units,
                          public.project_sgls, public.user_role_assignments, public.master_units;

      -- Never exposes the password column
      CREATE VIEW public.users AS
        SELECT id::varchar(20) AS id, name::varchar(200) AS name,
               is_hod = 1 AS is_hod, is_active = 1 AS is_active,
               created_on::timestamptz AS created_at
        FROM pc2_emp.users;

      CREATE VIEW public.projects AS
        SELECT id::varchar(50) AS id, name::varchar(200) AS name,
               created_by::varchar(20) AS created_by, created_on::timestamptz AS created_at
        FROM pc2_pims.projects
        WHERE is_active = 1;

      CREATE VIEW public.project_units AS
        SELECT u.id::int AS id, u.project_id::varchar(50) AS project_id,
               u.unit_no::varchar(50) AS unit_no, u.unit_name, u.parent_unit
        FROM pc2_pims.units u
        JOIN pc2_pims.projects p ON p.id = u.project_id AND p.is_active = 1
        WHERE u.is_active = 1;

      CREATE VIEW public.project_sgls AS
        SELECT project_id::varchar(50) AS project_id, user_id::varchar(20) AS user_id
        FROM pc2_pims.project_sgls;

      -- Master-unit groups = PIMS units.parent_unit (a unit that is its own parent is a master, not a child)
      CREATE VIEW public.master_units AS
        SELECT u.id::int AS id, u.project_id::varchar(50) AS project_id,
               u.parent_unit::varchar(50) AS master_unit, u.unit_no::varchar(50) AS child_unit,
               NULL::varchar(20) AS created_by, NULL::timestamptz AS created_at
        FROM pc2_pims.units u
        JOIN pc2_pims.projects p ON p.id = u.project_id AND p.is_active = 1
        WHERE u.is_active = 1
          AND nullif(trim(u.parent_unit), '') IS NOT NULL
          AND u.parent_unit <> u.unit_no;

      -- PIMS role codes → the role names ePULSE code uses; implied roles expanded
      -- (e.g. IM also holds Modeller / PC / MC / SC, per PIMS role_implications)
      CREATE VIEW public.user_role_assignments AS
        WITH effective AS (
          SELECT user_id, project_id, unit_no, role_code FROM pc2_pims.user_unit_roles
          UNION
          SELECT r.user_id, r.project_id, r.unit_no, i.implied_role_code
          FROM pc2_pims.user_unit_roles r
          JOIN pc2_pims.role_implications i ON i.role_code = r.role_code
        )
        SELECT row_number() OVER (ORDER BY user_id, project_id, unit_no, role_code)::int AS id,
               user_id::varchar(20) AS user_id, project_id::varchar(50) AS project_id,
               unit_no::varchar(50) AS unit_no,
               (CASE role_code
                  WHEN 'PC' THEN 'Process Checker'
                  WHEN 'MC' THEN 'Material Checker'
                  WHEN 'SC' THEN 'Stress Checker'
                  WHEN 'IM' THEN 'ISO Manager'
                  ELSE role_code
                END)::varchar(50) AS role
        FROM effective;
    `);

    console.log("  4/4 reading live counts from PC-2...");
    const { rows } = await client.query(`
      SELECT (SELECT count(*) FROM users)::int users,
             (SELECT count(*) FROM projects)::int projects,
             (SELECT count(*) FROM project_units)::int units,
             (SELECT count(*) FROM project_sgls)::int sgls,
             (SELECT count(*) FROM user_role_assignments)::int roles,
             (SELECT count(*) FROM master_units)::int master_unit_links`);

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("✅ Dry run OK — nothing changed. Live counts would be:", rows[0]);
    } else {
      await client.query("COMMIT");
      console.log(`✅ Linked to PC-2 (${emp.host}) — live counts:`, rows[0]);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Linking to PC-2 failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Linking to PC-2 failed:", err.message);
  process.exitCode = 1;
});
