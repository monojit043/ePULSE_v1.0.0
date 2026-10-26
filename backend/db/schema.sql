-- ============================================================
-- ePULSE PostgreSQL Schema
-- users / projects / project_sgls / project_units / user_role_assignments / master_units are
-- replaced by live views of PC-2 by `npm run db:link-pc2`. The PIMS ISO-workflow tables
-- (drawings, lots, iso_*, s3d_export_log) moved with PIMS to D:\PIMS_APP on 2026-10-21.
-- ============================================================

-- Users (from login.json → users[])
CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(20)  PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  password    VARCHAR(200) NOT NULL,
  is_hod      BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Projects (from login.json → projects[])
CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(50)  PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  created_by  VARCHAR(20)  REFERENCES users(id),
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- SGLs assigned to a project (project.sgls array)
CREATE TABLE IF NOT EXISTS project_sgls (
  project_id  VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  user_id     VARCHAR(20) REFERENCES users(id)    ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

-- Units that belong to a project (project.units.units array)
CREATE TABLE IF NOT EXISTS project_units (
  id          SERIAL      PRIMARY KEY,
  project_id  VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  unit_no     VARCHAR(50) NOT NULL,
  UNIQUE (project_id, unit_no)
);

-- Role assignments: user ↔ project ↔ unit ↔ role
-- (from user.projectAssignments[projectId].units[unitNo] = [roles])
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id          SERIAL      PRIMARY KEY,
  user_id     VARCHAR(20) REFERENCES users(id)    ON DELETE CASCADE,
  project_id  VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  unit_no     VARCHAR(50) NOT NULL,
  role        VARCHAR(50) NOT NULL,
  UNIQUE (user_id, project_id, unit_no, role)
);

-- Stress-critical lines: PIMS keeps its own (PIMS_SQL); SSMS reads PC-2's. Not in ePULSE since 2026-10-22.

-- ── Line List Normalizer ──────────────────────────────────────
-- One record per upload event (job + revision)
CREATE TABLE IF NOT EXISTS linelist_uploads (
  id           SERIAL        PRIMARY KEY,
  job_no       VARCHAR(50)   NOT NULL,
  source_files TEXT          DEFAULT '[]',
  rev_no       INTEGER       DEFAULT 0,
  uploaded_by  VARCHAR(20)   REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ   DEFAULT NOW(),
  row_count    INTEGER       DEFAULT 0,
  is_latest    BOOLEAN       DEFAULT TRUE
);

-- The current line list of each job is the table line_list (npm run db:line-list —
-- same columns as PC-2's cmp_pims_1014.line_list plus the normalizer extras).
-- The per-upload copy of every line (linelist_lines) was dropped on 2026-10-22.

CREATE INDEX IF NOT EXISTS idx_ll_uploads_job    ON linelist_uploads(job_no);
CREATE INDEX IF NOT EXISTS idx_ll_uploads_latest ON linelist_uploads(job_no, is_latest);

-- ── Master Unit groupings ─────────────────────────────────────────────────
-- SGL defines which child units share a lot-number sequence under a master
-- unit. One row per child unit; each child can belong to at most one group.
-- Lots are stored with unit_no = master_unit so the sequence and folder key
-- are consistent across the whole group. Standalone units have no row here.
CREATE TABLE IF NOT EXISTS master_units (
  id           SERIAL       PRIMARY KEY,
  project_id   VARCHAR(50)  REFERENCES projects(id) ON DELETE CASCADE,
  master_unit  VARCHAR(50)  NOT NULL,
  child_unit   VARCHAR(50)  NOT NULL,
  created_by   VARCHAR(20),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (project_id, child_unit)
);

CREATE INDEX IF NOT EXISTS idx_master_units_project  ON master_units(project_id);
CREATE INDEX IF NOT EXISTS idx_master_units_master   ON master_units(project_id, master_unit);

-- ---- Indexes for common lookups ----
CREATE INDEX IF NOT EXISTS idx_user_role_user         ON user_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_project      ON user_role_assignments(project_id);
