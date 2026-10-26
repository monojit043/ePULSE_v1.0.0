# PC-1 ↔ PC-2 Integration Guide

How any module (ePULSE, MRCS, SSMS, SIMS, IPMCS, …) must connect to the PIMS master data on PC-2.
Give this whole file to Claude (or a developer) before building login, users, projects or roles
in a new module. It describes what is **already built and proven in ePULSE**
(`D:\ePULSE_DEV_v1.0.0`) — copy that pattern; do not invent a new one.

Last updated: 2026-10-16.

---

## 1. The machines

| | PIMS server | Apps server (ePULSE, MRCS, GAD, SSMS, SIMS, IPMCS, …) |
|---|---|---|
| **Development** | **PC-2** — `10.22.147.168` (Wi-Fi, DHCP — IP can change) | **PC-1** — `10.22.147.76` |
| **Production (office)** | Office PIMS server | Office apps server |

- Both dev PCs run **PostgreSQL 18** on port **5432**.
- Each dev PC mirrors one office server. Whatever works between PC-1 and PC-2 must later work
  the same way between the two office servers — so **hosts, ports and passwords live only in `.env`**,
  never in code.

---

## 2. The rules (non-negotiable)

1. **PC-2 owns the master data. Modules only read it.**
   | Data | Lives in (on PC-2) |
   |---|---|
   | Login credentials, user name, HOD flag, active flag | DB **`eil_employees`**, table `users` |
   | Projects, units, unit parent (master unit), SGLs, role assignments | DB **`cmp_pims_1014`** |
2. **Live only — no sync, no copies, no caches.** Never build a job that copies users/projects/roles
   into the module's DB. Every read goes to PC-2 at request time. (A sync design was built once and
   explicitly rejected.)
3. **Never write to PC-2.** Connect read-only (`default_transaction_read_only=on`).
   Endpoints that would create projects, add units, assign roles or SGLs must return
   **403 "managed in PIMS"**.
4. **`cmp_pims_1014.users` is stale — never use it.** Users come only from `eil_employees.users`.
5. **Roles are checked live on every request**, never trusted from login time.
6. **Authorisation is per job + unit**, checked **on the server**. Hiding a button in the UI is a
   convenience, not security.

---

## 3. What is on PC-2

### `eil_employees.users`
| Column | Notes |
|---|---|
| `id` | Employee ID, e.g. `D351`. Unique **case-insensitively** (`upper(id)`). |
| `name` | |
| `password_hash` | ⚠ **Plain text**, despite the name. Most are `<ID>EIL`. Compare directly; never copy it anywhere. |
| `is_hod` | `0/1` |
| `is_active` | `0/1` — inactive users must not log in |
| `level`, `department` | currently empty |

### `cmp_pims_1014` (only these tables)
| Table | Key columns |
|---|---|
| `projects` | `id` (job no, e.g. `B862`), `name`, `created_by`, `created_on`, `is_active` |
| `units` | `project_id`, `unit_no`, `unit_name`, `parent_unit`, `is_active` |
| `project_sgls` | `project_id`, `user_id` |
| `user_unit_roles` | `user_id`, `project_id`, `unit_no`, `role_code` |
| `roles` | `code`: `Modeller`, `PC`, `MC`, `SC`, `GL`, `IM`, `SGL` |
| `role_implications` | `IM` ⇒ also `Modeller`, `PC`, `MC`, `SC` |
| `role_aliases` | old names → codes (e.g. "Material Checker" → `MC`) |

Role meanings: **PC** Process Checker · **MC** Material Checker · **SC** Stress Checker ·
**GL** Group Leader · **SGL** Senior Group Leader · **IM** Isometric (ISO) Manager · **Modeller**.

**Master units**: a unit's `parent_unit` is its master unit (e.g. all B889 units → `999` OFFSITE).
A unit whose parent is itself is a master, not a child.

---

## 4. How the live link works — `postgres_fdw`

The module's own database gets **foreign tables** that point at PC-2, and **views with the familiar
local names** on top of them. Module code just queries `users`, `projects`, `user_role_assignments`…
as if they were local — every read actually goes to PC-2, live. SQL joins between module tables and
these views work normally.

```
module DB (PC-1)                      PC-2
├─ schema pc2_emp
│   └─ users  (foreign) ────────────► eil_employees.users
├─ schema pc2_pims
│   ├─ projects, units, project_sgls,
│   │  user_unit_roles,
│   │  role_implications (foreign) ──► cmp_pims_1014.*
└─ public (views, read-only)
    ├─ users                  ← pc2_emp.users (NO password column)
    ├─ projects               ← active projects
    ├─ project_units          ← active units of active projects (+ unit_name, parent_unit)
    ├─ project_sgls
    ├─ user_role_assignments  ← user_unit_roles + implied roles, codes → names
    └─ master_units           ← units.parent_unit
```

### Reference implementation — copy it
- **`backend/db/linkPc2.js`** in ePULSE. Run with `npm run db:link-pc2`.
  - Reads `EMP_DB_*` / `PIMS_DB_*` from `.env`; password from `.env` or `%APPDATA%\postgresql\pgpass.conf`.
  - One transaction; **safe to re-run** (rebuilds everything).
  - **`DRY_RUN=1`** runs every step, prints live counts, then rolls back — always run this first.
  - Foreign servers use **`connect_timeout '10'`** so an unreachable PC-2 fails fast instead of hanging.
  - On first run it drops the old local tables of the same names (and the FKs pointing at them).

Core SQL it runs (simplified):

```sql
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER pc2_employees FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '10.22.147.168', port '5432', dbname 'eil_employees', connect_timeout '10');
CREATE USER MAPPING FOR CURRENT_USER SERVER pc2_employees OPTIONS (user 'postgres', password '…');
-- same for pc2_pims → dbname 'cmp_pims_1014'

CREATE SCHEMA pc2_emp;  CREATE SCHEMA pc2_pims;
IMPORT FOREIGN SCHEMA public LIMIT TO (users) FROM SERVER pc2_employees INTO pc2_emp;
IMPORT FOREIGN SCHEMA public LIMIT TO (projects, units, project_sgls, user_unit_roles, role_implications)
  FROM SERVER pc2_pims INTO pc2_pims;

CREATE VIEW users AS
  SELECT id, name, is_hod = 1 AS is_hod, is_active = 1 AS is_active, created_on::timestamptz AS created_at
  FROM pc2_emp.users;                                   -- password deliberately NOT exposed

CREATE VIEW user_role_assignments AS
  WITH effective AS (
    SELECT user_id, project_id, unit_no, role_code FROM pc2_pims.user_unit_roles
    UNION
    SELECT r.user_id, r.project_id, r.unit_no, i.implied_role_code
    FROM pc2_pims.user_unit_roles r JOIN pc2_pims.role_implications i ON i.role_code = r.role_code
  )
  SELECT user_id, project_id, unit_no,
         CASE role_code WHEN 'PC' THEN 'Process Checker' WHEN 'MC' THEN 'Material Checker'
                        WHEN 'SC' THEN 'Stress Checker'  WHEN 'IM' THEN 'ISO Manager'
                        ELSE role_code END AS role
  FROM effective;

CREATE VIEW master_units AS
  SELECT project_id, parent_unit AS master_unit, unit_no AS child_unit
  FROM pc2_pims.units
  WHERE is_active = 1 AND nullif(trim(parent_unit), '') IS NOT NULL AND parent_unit <> unit_no;
```

> **Role names:** ePULSE maps codes to long names (`PC` → "Process Checker") only because its older
> code already used those names. **A new module may use the PIMS codes directly** — just be consistent,
> and still expand `role_implications` (an IM must count as Modeller/PC/MC/SC).

> **If the module's DB is itself on PC-2** (e.g. the `mrcs` database already exists there), the same
> pattern still works — point the foreign servers at `localhost`. Do not query another database's
> tables by any other route.

### Consequences
- **No foreign keys** to `users` / `projects` / units. PostgreSQL can't enforce a FK against another
  database. Store the IDs as plain columns (`uploaded_by VARCHAR(20)`, `job_no`, `unit_no`) and join to
  the views when you need names.
- **If PC-2 is down, login and every role check fail.** That is accepted ("live only"). Return a clear
  503, never fall back to stale data.

---

## 5. Login

- One shared login check, against `pc2_emp.users`:
  ```sql
  SELECT id, name, is_hod = 1 AS is_hod FROM pc2_emp.users
  WHERE upper(id) = upper($1) AND password_hash = $2 AND is_active = 1
  ```
- Store in the session only `{ id, name, isHod, isSgl, roles }`. **Never store or copy the password.**
- PC-2 unreachable → `503 "Login server (employee database) is unreachable"`.
- Change-password inside a module → disabled (`403 "Passwords are managed centrally"`) — PC-2 owns it.
- Each module may have its **own login page** (ePULSE has `gateway-login.html` and `gad-login.html`)
  but all of them post to the same login logic. After login, always land on that module's own home
  page; sign-out returns to that module's login page (use `location.replace` so Back doesn't reopen it).

Reference: `backend/controllers/authController.js`, `backend/db/queries/userQueries.js`
(`findByCredentials`, `loadLiveUser`).

### 5b. Single sign-on across modules (built 2026-10-17: ePULSE ↔ MRCS)
- One shared cookie, **`eil_sso`**, holding a signed token `{ sub: employeeId, exp }` (HMAC-SHA256).
- Module **`utils/sso.js`** — the **identical file** in every app
  (ePULSE `backend/utils/sso.js`, MRCS `backend/src/utils/sso.js`). No extra npm packages.
- **`SSO_SECRET`** in every app's `.env` — must be **the same value** everywhere (≥ 32 chars).
- Sign in to any app → it sets the cookie. Sign out of any app → it clears the cookie → signed out of
  all apps. The cookie only says *who*; each app still reads active flag, department and roles **live**.
- Session-based app (ePULSE): the per-request middleware takes the user from the cookie; no cookie →
  session destroyed (401).
- Token-based app (MRCS): `GET /api/auth/sso` turns the cookie into the app's own JWT (used by the login
  page and on every page load); `authenticateToken` also requires the cookie to name the same user.
- ⚠ Browsers share cookies by **hostname, not port** — open all apps through the **same host**
  (e.g. `http://<apps-server>:3300` and `http://<apps-server>:5500`). `localhost` vs an IP, or two
  different servers, do **not** share the sign-in. The gateway builds module links from its own
  hostname (`data-same-host-port`) for this reason.
- Adding a new module: copy `sso.js`, add `SSO_SECRET`, set the cookie on login, clear it on logout,
  check it on every request.

### 5c. MRCS specifics (reference for module-owned roles)
- `master_employees` = live view of `eil_employees.users` (active users **with a department** only).
  Department names are exact: `piping`, `process`, `PEM`, `architecture`, `structural`, `general civil`.
- MRCS keeps its **own** roles (JE / LE / GL per job / unit / stage / department) in `user_assignments`
  — module-owned roles stay in the module; only identity comes from PC-2.
- **Any active employee can sign in**; what they see depends on their MRCS assignments (no assignment →
  role null → every route shows only assigned items, i.e. nothing; admin/PEM routes refuse).
- **Roles are per review, never global** (2026-10-18): every route acting on a job / unit / stage
  checks the caller's role **on that review** (`src/services/reviewAccess.js`). Being GL on one
  review gives no rights on another. The token's "highest role" only gates pages coarsely.
- **Department leads (2026-10-18) — GL is computed live, never stored.** View `effective_assignments`
  = MRCS `user_assignments` (LE / JE) **plus** computed GL rows:
  PIMS GL / SGL on any unit of a group → GL on its master unit; PIMS project SGL → GL on every master
  unit of that job; `eil_employees.level >= 17` → GL on every master unit of every PIMS job (own
  department). Computed GL covers all stages. A GL assigns LE / JE, an LE assigns JE — own department,
  PIMS-validated job / master unit / stage, no review needed. Each department creates its own internal
  reviews directly (no PEM external review needed). PEM no longer assigns other departments' leads.
  Access checks read `effective_assignments`; notification emails use only assigned + PIMS GLs.
- **PEM rights come from the department alone:** department `PEM` on PC-2 ⇒ MRCS role GL, no
  assignment needed (so PEM can create reviews and assign the first people). `src/services/liveUser.js`.
- Link script: `D:\MRCStest\backend\src\data\linkPc2.js` (`npm run db:link-pc2`, `DRY_RUN=1` first).
- **Jobs / units (2026-10-18):** reviews may only use **PIMS jobs**, live. Views `pims_projects`
  (job_no, job_name) and `pims_units` (job_no, unit_no, unit_name, master_unit, is_master).
  - **Master unit** = top-most parent via `units.parent_unit`; no parent or parent = itself → master.
  - Reviews are created on **master units only**; a review on a master covers its whole group.
  - Stages from `stage_prerequisites_master` (30%, 60%, 90%).
  - `POST /api/initiation` validates all three server-side (`src/services/pimsLookup.js`);
    form dropdowns use `GET /api/pims/jobs | master-units | unit-group | stages`.
  - A unit that later stops being a master in PIMS keeps its review, flagged in the list.
  - Reviews for jobs outside PIMS: planned later (separate MRCS-owned list for PEM / GL).

---

## 6. Live roles on every request

A middleware on every `/api` route re-reads the signed-in user from the views and replaces
`req.session.user`:

```js
// backend/middleware/auth.js → refreshLiveUser (mounted in app.js: app.use("/api", refreshLiveUser))
const live = await userQ.loadLiveUser(req.session.user.id);   // HOD, SGL, roles from PC-2
if (!live)  → destroy session, 401 "Your account is no longer active"   // deactivated in eil_employees
else        → req.session.user = live; next()
on error    → 503 "Role server (PC-2) is unreachable"                    // never use stale roles
```

Result: a role added/removed in PIMS applies on the user's **next click**, no re-login; a deactivated
user is signed out immediately. All existing `requireAnyRole(...)`-style guards become live for free.

Proven by test: tampering the stored session to claim HOD/GL/SGL had no effect — the server returned
PC-2's real roles and corrected the session.

---

## 7. Authorisation pattern (per job + unit)

- Helper: `getRolesForUnit(userId, jobNo, unitNo)` → role list for that exact job/unit, read live.
- **HOD is exempt** from role checks (but not from independence rules below).
- Check **on the server, per item**, inside the action — not only at route level. A user who is
  Modeller on B862/101 must not be able to act on B889/417.
- The UI should hide what the user can't do (fetch `/api/users/my-roles` — live per job/unit), and
  the server must still refuse it.
- When a batch action partly fails, process the rest and **return each refusal with a reason**; the UI
  must show those reasons (don't report success silently).
- Unknown job/unit (e.g. typo in a file name) is automatically refused, because nobody has a role on it.

Examples already built in ePULSE:
| Action | Rule |
|---|---|
| GAD upload | Modeller on that file's job/unit (HOD: any) |
| GAD Modeller resubmit | Modeller on that job/unit |
| Claim GAD as By / By+Check / Check | PC, MC or SC on that job/unit **and not the uploader** |
| Claim GAD as GL | GL on that job/unit |
| Clash report upload | any role **other than Modeller** on that job/unit (HOD: any) |

**Independent review:** whoever uploaded/created an item can't be its reviewer. Hide it from their
review pool and refuse the claim on the server.

---

## 8. Data a module owns that PC-2 will read

Some data is created in a module and **PIMS on PC-2 reads it** (e.g. ePULSE owns the clash report
table `iso_clash_items`). Rules:
- The module is the owner and the only writer.
- Nothing else on PC-1 reads it as a hidden dependency.
- For PC-2 to read it, PC-1 must allow PC-2 in — same steps as §9 but on PC-1, plus a **read-only login
  limited to those tables** (not `postgres`). *(Not set up yet for ePULSE.)*

Upload pattern used for such data (ePULSE clash upload):
- Keep every uploaded original file unchanged (`uploads/<feature>/<job>/<unit>/<timestamp>_<name>`) and
  log it in an uploads table (who, when, rows stored, rows skipped); offer download.
- Replace the current data **only for the selected job/unit**, in one transaction.
- Rows that clearly belong to another unit are **skipped and reported**; if **no** row matches, reject
  the whole file and change nothing.

---

## 9. One-time setup per machine pair

### On PC-2 (the PIMS server)
1. `C:\Program Files\PostgreSQL\18\data\postgresql.conf` → `listen_addresses = '*'`
2. `C:\Program Files\PostgreSQL\18\data\pg_hba.conf` → add at the bottom, **with the `/24` mask**:
   ```
   host    all    all    10.22.147.0/24    scram-sha-256
   ```
   A line without a mask (e.g. `10.22.147.76` alone) breaks the whole file and **stops every connection,
   including PIMS itself**. Save as UTF-8, keep the name `pg_hba.conf`.
3. Firewall (admin cmd):
   ```bat
   netsh advfirewall firewall add rule name="PostgreSQL 5432" dir=in action=allow protocol=TCP localport=5432 remoteip=10.22.147.0/24
   ```
4. `net stop postgresql-x64-18` / `net start postgresql-x64-18`
5. *(Recommended)* create a read-only login for modules instead of `postgres`.

### On PC-1 (the module's machine)
1. `%APPDATA%\postgresql\pgpass.conf` → `10.22.147.168:5432:*:postgres:<PC-2 password>`
2. Module `.env`:
   ```
   EMP_DB_HOST=10.22.147.168   EMP_DB_PORT=5432   EMP_DB_NAME=eil_employees   EMP_DB_USER=postgres   EMP_DB_PASSWORD=
   PIMS_DB_HOST=10.22.147.168  PIMS_DB_PORT=5432  PIMS_DB_NAME=cmp_pims_1014  PIMS_DB_USER=postgres  PIMS_DB_PASSWORD=
   ```
   (blank password → taken from `pgpass.conf`)
3. `DRY_RUN=1 npm run db:link-pc2` → must end `✅ Dry run OK`; then `npm run db:link-pc2`.
4. Test: `psql -h 10.22.147.168 -U postgres -d eil_employees -c "select count(*) from users"`

### When an IP changes (it has: `10.63.39.x` → `10.22.147.x`)
Update `*_DB_HOST` in `.env` and the `pgpass.conf` line → re-run `npm run db:link-pc2` → on PC-2 add the
new `/24` to `pg_hba.conf` and the firewall rule (`netsh advfirewall firewall set rule name="PostgreSQL 5432" new remoteip=<old>/24,<new>/24`) → restart PostgreSQL. No code changes.
*Better long-term: a fixed IP for PC-2, or use its computer name in `.env`.*

---

## 10. Gotchas learned the hard way

- **PC-2 sleeps / drops off Wi-Fi** → hangs and "could not connect to server pc2_*". Set PC-2 to never
  sleep and disable Wi-Fi power saving.
- **Ping to PC-2 is blocked** by its firewall even when it is up. Test **port 5432** instead
  (`Test-NetConnection 10.22.147.168 -Port 5432`, or psql).
- A hung fdw connection holds a lock; later runs queue behind it. Check
  `pg_stat_activity` (`wait_event = 'PostgresFdwConnect'`) and terminate those sessions.
- The PC-2 `postgres` password ends up stored in the module DB's user mapping — another reason for a
  read-only login on PC-2.
- `psql` output on Windows has CRLF line endings — strip `\r` before comparing lists in scripts.
- PIMS passwords are plain text (87 of 93 are the `<ID>EIL` default). Flag it; don't build on it.

---

## 11. Working rules for Claude on these modules

- **Exploring PC-2:** read-only only — `PGOPTIONS="-c default_transaction_read_only=on"`. Never change
  anything on PC-2.
- **The user tests the running app at the same time.** Immediately before any test that writes or
  replaces data, re-check the target table for real rows; prefer a job/unit nobody uses; clean up all
  test rows, files and sessions afterwards. (A replace-style upload test once wiped a real upload.)
- Test with the users whose credentials are known for testing (e.g. HOD `1234`, Modeller-only `06NC`);
  check their live roles first.
- Destructive DB steps (dropping tables, re-linking): explain exactly what will happen, take a backup
  (`pg_dump -Fc`), do a dry run, then run.
- Ask before deciding things that are the user's call (who may do what, numbering rules, what feeds
  what). Don't guess business rules.

---

## 12. Short prompt to give Claude in a new module

> This module must use the PC-1 ↔ PC-2 integration described in `PC1_PC2_INTEGRATION_GUIDE.md`
> (copy it into this repo). Users and login come live from `eil_employees` on PC-2; projects, units,
> master units, SGLs and roles come live from `cmp_pims_1014`. No sync and no copies — use
> `postgres_fdw` foreign tables + read-only views, exactly like ePULSE's `backend/db/linkPc2.js`.
> Never write to PC-2. Refresh the user's roles from PC-2 on every API request, check permissions on
> the server per job/unit, and return 403 "managed in PIMS" for any master-data edit. Read the guide
> fully before writing code, and ask me before deciding any business rule.
