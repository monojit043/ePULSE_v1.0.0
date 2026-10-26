// Creates the ePULSE line list table `line_list` — the SAME table as PC-2's cmp_pims_1014.line_list
// (same column names, types, order, keys and indexes), plus 7 extra columns at the end that the
// Line List Normalizer produces and PC-2 has no place for (decided 2026-10-19).
//
// From now on the line list lives HERE (PC-1). ll-normalize.html saves into it; ePULSE pages and
// SSMS read it. On first run the current PC-2 rows are copied in once (PC-2 is only read).
//
// Differences from PC-2 that PostgreSQL forces:
//   - no foreign keys to projects / lines (those live on PC-2; projects here is a live view)
//   - id gets a default sequence so uploads can insert (copied rows keep their PC-2 ids)
//
// Run:  npm run db:line-list        (DRY_RUN=1 first; safe to re-run — never copies twice)
//        NO_COPY=1 npm run db:line-list   → create the table EMPTY (fresh production install)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("./pool");

const DRY_RUN = process.env.DRY_RUN === "1";
const NO_COPY = process.env.NO_COPY === "1";

// Columns 1–26 exactly as on PC-2, then the normalizer extras
const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS public.line_list (
    id                   bigint NOT NULL,
    line_id              bigint,
    project_id           varchar(255) NOT NULL,
    parent_unit          varchar(255),
    unit_no              varchar(255),
    service              varchar(255),
    pid_no               varchar(1000),
    line_no              varchar(255) NOT NULL,
    line_size            varchar(255),
    line_size_unit       varchar(255),
    line_class           varchar(255),
    line_from            varchar(255),
    line_to              varchar(255),
    insulation           varchar(255),
    insulation_thickness varchar(255),
    design_press         varchar(255),
    design_press_unit    varchar(255),
    design_temp          varchar(255),
    design_temp_unit     varchar(255),
    oper_press           varchar(255),
    oper_press_unit      varchar(255),
    oper_temp            varchar(255),
    oper_temp_unit       varchar(255),
    has_mismatch         integer NOT NULL DEFAULT 0,
    saved_by             varchar(255),
    saved_on             varchar(255),
    -- extras from the Line List Normalizer (not on PC-2)
    min_design_press         varchar(255),
    min_design_press_unit    varchar(255),
    min_design_temp          varchar(255),
    min_design_temp_unit     varchar(255),
    min_operating_press      varchar(255),
    min_operating_press_unit varchar(255),
    min_operating_temp       varchar(255),
    min_operating_temp_unit  varchar(255),
    full_vaccum              varchar(255),
    fluid_state              varchar(255),
    multi_phase              varchar(255),
    CONSTRAINT line_list_pkey PRIMARY KEY (id),
    CONSTRAINT line_list_project_id_unit_no_line_no_service_key UNIQUE (project_id, unit_no, line_no, service),
    CONSTRAINT line_list_has_mismatch_check CHECK (has_mismatch = ANY (ARRAY[0, 1]))
  );
  CREATE INDEX IF NOT EXISTS idx_linelist_line ON public.line_list USING btree (line_id);
  CREATE INDEX IF NOT EXISTS idx_linelist_pt   ON public.line_list USING btree (service, parent_unit, line_no);
  CREATE SEQUENCE IF NOT EXISTS public.line_list_id_seq OWNED BY public.line_list.id;
  ALTER TABLE public.line_list ALTER COLUMN id SET DEFAULT nextval('public.line_list_id_seq');
`;

const PC2_COLS = [
  "id", "line_id", "project_id", "parent_unit", "unit_no", "service", "pid_no", "line_no",
  "line_size", "line_size_unit", "line_class", "line_from", "line_to", "insulation",
  "insulation_thickness", "design_press", "design_press_unit", "design_temp", "design_temp_unit",
  "oper_press", "oper_press_unit", "oper_temp", "oper_temp_unit", "has_mismatch", "saved_by", "saved_on",
];

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Creating line_list in ${process.env.DB_NAME}${DRY_RUN ? " — DRY RUN, will roll back" : ""}`);
    await client.query("BEGIN");
    await client.query(CREATE_SQL);

    const { rows: [{ n: existing }] } = await client.query("SELECT count(*)::int n FROM line_list");
    let copied = 0;
    if (existing === 0 && NO_COPY) {
      console.log("  table is empty — NO_COPY=1, leaving it empty");
    } else if (existing === 0) {
      // One-time copy from PC-2 through the existing pc2_pims link (read-only), via a scratch schema
      console.log("  table is empty — copying the current rows from PC-2 (read-only)...");
      await client.query(`
        DROP SCHEMA IF EXISTS pc2_line_list_copy CASCADE;
        CREATE SCHEMA pc2_line_list_copy;
        IMPORT FOREIGN SCHEMA public LIMIT TO (line_list) FROM SERVER pc2_pims INTO pc2_line_list_copy;`);
      const r = await client.query(
        `INSERT INTO line_list (${PC2_COLS.join(", ")})
         SELECT ${PC2_COLS.join(", ")} FROM pc2_line_list_copy.line_list`
      );
      copied = r.rowCount;
      await client.query("DROP SCHEMA pc2_line_list_copy CASCADE");
    } else {
      console.log(`  table already has ${existing} rows — not copying again`);
    }
    await client.query(`SELECT setval('line_list_id_seq', GREATEST((SELECT max(id) FROM line_list), 1))`);

    const { rows } = await client.query(
      "SELECT project_id, count(*)::int AS lines FROM line_list GROUP BY 1 ORDER BY 1"
    );
    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log(`✅ Dry run OK — nothing changed. Would copy ${copied} rows:`, rows);
    } else {
      await client.query("COMMIT");
      console.log(`✅ line_list ready (copied ${copied} rows now):`, rows);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ line_list setup failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
