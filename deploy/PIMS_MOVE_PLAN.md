# PIMS Move Plan

Move **PIMS – Piping Isometrics Management System** out of ePULSE into its own application, the
same way Meetings was split out of MRCS (`D:\MEETINGS_APP`).

**Status:** **Done.** Phase A 2026-10-21 — `D:\PIMS_APP` runs on :3400 (local git, commit `9417b3b`, not
pushed); inch link applied. **Phase B 2026-10-22** — PIMS removed from ePULSE (see "Phase B — what was done").
**Replaces:** the 2026-10-15 version of this file (its file lists were re-checked and are still accurate).

---

## 0. Decisions (agreed 2026-10-21)

| # | Topic | Decision |
|---|---|---|
| 1 | Where PIMS lives | New folder **`D:\PIMS_APP`** with its own git repository. `D:\PIMS_SQL` stays untouched as an archive. |
| 2 | Sign-in | PIMS keeps **its own users and login** from the `PIMS_SQL` database, as before. No shared sign-on with ePULSE / MRCS / SSMS. |
| 3 | Line list and clash data | PIMS reads **its own** `linelist_lines` (710 rows) and `iso_clash_items` (1,384) in `PIMS_SQL`. The ISO pre-check **"Clash in Model"** is restored. |
| 4 | INCH Data Upload | **Stays in ePULSE.** ePULSE owns `inch_data`; PIMS reads it live (see §4). |
| 4 | Generate Report | **Part of PIMS.** ePULSE keeps a **"Generate Report"** button that opens the PIMS report page. |
| 5 | Port | PIMS runs on **3400** (3300 ePULSE, 4000 SSMS, 5500 MRCS, 5600 Meetings). |

---

## 1. Facts this plan is based on (checked 2026-10-19 / 21)

- **Data:** every PIMS table in the ePULSE database is empty (`drawings`, `drawing_*`, `lots`, `lot_lines`,
  `iso_*` except `iso_clash_items`, `s3d_export_log`, `inch_data`). The `PIMS_SQL` database holds all
  PIMS data: 92 drawings, 51 lots, 150 ISO submissions, 1,035 pre-check results, 9,324 inch rows, plus
  its own `users` (50), `projects` (2), `user_role_assignments` (346). **No PIMS data has to move.**
- **Code:** ePULSE began as a copy of `D:\PIMS_SQL`. The PIMS code is identical in both, except 5 files
  changed in ePULSE on 2026-10-19 (new line list, Clash in Model removed) — see §2 step 5.
- **`D:\PIMS_SQL`** = old full copy (PIMS + GAD + P&ID + utilities), GitHub repo `PIMS-V1.0`,
  48 uncommitted changes, `PORT=3300` (clashes with ePULSE).
- **ISO files** (~100 MB, `uploads/B378`, `uploads/B862`) exist in both folders; they belong to `PIMS_SQL`.
- **Only PIMS code reads `inch_data`:** `lotController`, `dashboardController`, `reportController`,
  `db/queries/drawingQueries.js`, `db/queries/isoPreCheckQueries.js`. ePULSE's `inchController` only writes it.

---

## 2. Phase A — build the PIMS app (ePULSE is not touched)

1. Create `D:\PIMS_APP` with `backend/` and `public/`, same layout as ePULSE.
2. **Copy the PIMS-only files from ePULSE:**
   - Pages (`public/`): `user.html`, `index.html`, `hod.html`, `sgl.html`, `dashboard.html`,
     `linelist.html`, `pdfviewer.html`, `user-manual.html`, `report.html`
   - JS (`public/js/`): `user.js`, `script.js`, `left-top.js`, `left-bottom.js`, `perform.js`, `final.js`,
     `stress.js`, `upload.js`, `eng-data.js`, `hod.js`, `sgl.js`, `login.js`, `PIMSsignin.js`,
     `dashboard.js`, `report.js`
   - CSS (`public/css/`): `hod.css`, `sgl.css`, `index.css`, `dashboard.css`, `report.css`
   - Routes: `drawingRoutes`, `lotRoutes`, `dashboardRoutes`, `batchRoutes`, `isoPreCheckRoutes`,
     `stressRoutes`, `reportRoutes`
   - Controllers: `drawingController`, `lotController`, `dashboardController`, `stressController`,
     `reportController`
   - Queries (`db/queries/`): `drawingQueries`, `isoPreCheckQueries`, `s3dExportQueries`, `stressQueries`
   - Services: `isoPreCheckService`, `isoIdfFetcher`, `isoIdfParser`
   - Jobs: `batchUpload.js`, `s3dExport.js`, `scheduler.js`
   - Other: `db/iso_prechecks_schema.sql`, `data/PIMS_User_Manual.pdf`, `test_idf.js`
3. **Copy the shared base** PIMS needs to run (a copy also stays in ePULSE):
   `app.js`, `server.js`, `package.json`, `db/pool.js`, `db/pgSessionStore.js`, `middleware/`
   (`auth.js`, `noCache.js`), `utils/sse.js`; login / users / projects / master units
   (`authRoutes`, `authController`, `userRoutes`, `userController`, `userQueries`, `projectRoutes`,
   `projectController`, `projectQueries`, `masterUnitRoutes`, `masterUnitController`);
   `notificationRoutes` + `notificationController` (whole — PIMS needs both the bell and the ISO
   workflow endpoints); `services/isoPdfParser.js`; `public/js/notifications.js`,
   `public/css/notifications.css`, `public/css/user.css`.
   - Take login / users / projects / auth middleware from **`D:\PIMS_SQL`** (its own local users and
     roles, no `eil_employees`, no single sign-on cookie) — decision 2.
4. **Trim start-up** (`app.js`, `server.js`): mount only PIMS routes. No GAD, P&ID, utilities,
   line-list normalizer, clash upload, INCH upload, `linkPc2`, `sso`.
5. **Use the `D:\PIMS_SQL` versions of the 5 files changed in ePULSE on 2026-10-19**, so PIMS reads its
   own line list and runs Clash in Model again (decision 3):
   `controllers/drawingController.js`, `controllers/reportController.js`,
   `services/isoPreCheckService.js`, `db/queries/isoPreCheckQueries.js`, `routes/isoPreCheckRoutes.js`.
6. **Settings:** `.env` with `DB_NAME=PIMS_SQL`, `PORT=3400`; `.env.example` with blank secrets;
   `README.md` like the Meetings one; `.gitignore` (`.env`, `node_modules`, uploads, logs).
7. **Files:** copy `uploads/` (ISO files, without `clash/`), `IDF/`, `output/`, `s3d_export_logs/`,
   empty `batch_input/` and `batch_logs/` from `D:\PIMS_SQL`.
8. **Inch data link** — see §4.
9. **Test on PIMS_SQL** (re-check for real data before every write test; use `ZZTEST` markers):
   login (PIMS's own users), ISO list, upload, claim, check / review comments, lots, dashboard,
   report, ISO pre-checks incl. Clash in Model, batch upload, S3D export.
   **Only one app may run the scheduler** (batch / S3D jobs) on these folders.
10. Commit locally; push to a new GitHub repository only when asked.

---

### Phase A — what was done (2026-10-21)

- Code from `D:\PIMS_SQL` (97 files incl. README, `.env.example`); `app.js` mounts only PIMS routes.
- `dashboard.html` was **not** moved — it is the old general dashboard (links to GAD / line-list tools),
  and PIMS's own login sends users to `user.html` / `hod.html` / `sgl.html`. It stays in ePULSE.
- `perform.js` is used by both `user.html` (PIMS) and `gad.html` (GAD) — PIMS has a copy; ePULSE keeps its own.
- PIMS pages call 4 read endpoints of tools that stay in ePULSE (`/api/inch/line`, `/api/inch/unit`,
  `/api/lms/line`, `/api/linelist/line-data`): PIMS has its own read-only copy of just those
  (`routes/lookupRoutes.js`, functions copied unchanged).
- Links to the Gateway, Stress Critical Index (`ll-stress`), MRCS and SSMS open the real app on the
  same host (:3300 / :5500 / :4000).
- IDF and S3D export folders default to `D:\PIMS_APP\IDF` and `D:\PIMS_APP\output`.
- `PIMS_SQL.inch_data` (9,324 rows) copied into ePULSE once, checked identical; PIMS's table kept as
  `inch_data_before_link`; `inch_data` is now a live view of ePULSE's table (`npm run db:link-epulse`).
- Backups before any change: `D:\PIMS_APP\backend\db_backups\` (PIMS_SQL and ePULSE, 2026-10-21 23:13).
- Tested on :3400: all 41 pages/assets; 73 read endpoints × 4 users (HOD, SGL, Modeller/checker,
  Material Checker) with no 404/5xx; inch (live link), LMS, line-list data; ISO pre-check incl.
  Clash in Model; lot export; full write flow on a throw-away project `ZZTEST` (create project, unit,
  role, ISO upload, file stored, pre-check ran) — removed afterwards, every table identical to before.

**Open after Phase A:**
- **S3D export folder:** PIMS now writes the lock feed to `D:\PIMS_APP\output` at 19:30. If S3D reads
  from another folder (it was `D:\PIMS_SQL\output`), set `S3D_EXPORT_DIR` in PIMS's `.env`.
- **Two schedulers until Phase B:** ePULSE still runs the same scheduler on its (empty) PIMS tables
  and writes an empty lock feed to `D:\PIMS_SQL\output` at 19:30. Phase B step 1 removes it.

## 3. Phase B — remove PIMS from ePULSE (after Phase A works)

1. **Untangle shared pieces:**
   - Split `controllers/notificationController.js`: keep the bell (`sseStream`, `getNotifList`,
     `markAllRead`, `markOneRead` → `GET /notif/stream`, `GET /notif`, `PUT /notif/read-all`,
     `PUT /notif/:id/read`); remove the ~30 ISO-workflow endpoints from ePULSE's copy and
     `routes/notificationRoutes.js`.
   - `controllers/stressIndexController.js` (`ll-stress.html`): remove `ALTER TABLE drawings …`
     (line 22) and the `drawings` reads / `UPDATE drawings SET stress_critical …` (~lines 147–380).
   - `server.js`: remove `initLotTables()` and `require("./jobs/scheduler")`.
   - `app.js`: remove the routes moved in §2.
2. **Gateway** (`public/gateway.html`, `public/js/gateway.js`):
   - "PIMS – Piping Isometrics Management System" → opens the PIMS app on the same host, port 3400
     (its own login).
   - **"Generate Report"** button stays → opens `http://<same host>:3400/report.html`
     (user signs in to PIMS if not already).
   - Remove links to `user.html`, `dashboard.html`; keep Clash Report Upload and INCH Data Upload.
3. **Delete the moved files** from ePULSE (everything in §2 step 2). Keep INCH upload
   (`inch-upload.html`, `inchController`, `inchRoutes`).
4. **Database:** back up, then drop ePULSE's empty PIMS tables: `drawings`, `drawing_claims`,
   `drawing_comment_files`, `drawing_comments`, `drawing_history`, `lots`, `lot_lines`,
   `iso_bom_items`, `iso_pdf_submissions`, `iso_pipe_schedule`, `iso_pre_check_results`,
   `iso_special_items`, `iso_weld_records`, `s3d_export_log`.
   **Keep** `iso_clash_items` + `clash_uploads` (ePULSE owns them) and `inch_data` (§4).
5. Remove the duplicate ISO files from ePULSE's `backend/uploads/` (`B378`, `B862`, `ZZTEST_DEADLOCK`);
   keep `uploads/clash/` and `_pid_staging/`.
6. **Verify ePULSE:** gateway login, every menu item, GAD (upload, claim, review, lots), notification
   bell, utilities (line list, LMS, stress index, P&ID), Clash upload, INCH upload, MRCS / SSMS links.
   Search for leftovers: `drawings`, `drawing_`, `lots`, `lot_lines`, `iso_` (except clash),
   `s3d_export`, `user.html`, `dashboard.html`, `report.html`.

---

### Phase B — what was done (2026-10-22)

- **Backups first:** code copy `D:\ePULSE_backups\code_before_pims_removal_20261021_233557\` (2,857 files incl.
  uploads) and DB dump `D:\ePULSE_backups\ePULSE_DEV_before_pims_removal_20261021_233557.dump`.
- **Notification bell:** `notificationController.js` / `notificationRoutes.js` reduced to the 4 bell endpoints;
  the list no longer joins `drawings` (the bell never showed those fields; GAD uses its own `gad_id`).
- **Stress Critical Line List Prep (`ll-stress`)** — decided 2026-10-22: **cut the link**. It keeps its own
  `stress_index` in ePULSE and no longer marks ISO drawings critical (PIMS keeps its own 553-line index in
  PIMS_SQL). The "In Drawings" / "Current SC" columns, "Not in Drawings" chip and "drawings set critical"
  text were removed from the page.
- **Start-up:** `server.js` no longer runs `initLotTables()` or the batch / S3D scheduler; `app.js` mounts no
  PIMS routes. Login's suggested landing page is the gateway.
- **Gateway:** "PIMS" → PIMS login on :3400; "Generate Report" → PIMS `report.html` on :3400 (it sends users
  to PIMS's login first if needed). The gateway login's "PIMS direct login" link and the old `dashboard.html`
  PIMS links also open :3400. Pages that redirected to PIMS's `/index.html` when not signed in
  (INCH upload, LMS, stress index, dashboard) now go to `/gateway-login.html`.
- **Deleted from ePULSE:** 32 page files (incl. `perform.js` and `pdfviewer.html` — PIMS-only; GAD uses
  `gad-perform.js`), 26 backend files (incl. `db/seed.js`, `db/iso_prechecks_schema.sql`, the PIMS user
  manual PDF), the ISO zone folders under `uploads/<job>/<unit>/` (259 files, all identical copies already
  in PIMS_APP), `ZZTEST_DEADLOCK`, `batch_input/`, `batch_logs/`, `s3d_export_logs/`, root `IDF/`, `output/`.
  **Kept:** `uploads/<job>/<unit>/gad/` and `PID/`, `uploads/clash/`, `uploads/_pid_staging/`, and the files
  still used by GAD / gateway (`notifications.js/.css`, `user.css`, the GAD-login images).
- **`db/schema.sql`:** PIMS ISO tables removed (users / projects / line list / master units / stress_lines kept).
- **Database:** the 14 empty PIMS tables dropped (re-checked empty first; nothing else depended on them).
- **Settings / packages:** `BATCH_CRON_SCHEDULE`, `BATCH_INPUT_DIR`, `IDF_FOLDER` removed from `.env`
  (old copy `.env.bak_before_pims_removal`); `db:seed` script removed; unused packages `node-cron`,
  `cookie-parser`, `cors`, `memorystore`, `pdfkit` uninstalled.
- **Verified on :3310:** clean start-up (PC-2 link OK, no scheduler); all 64 remaining page/asset files load;
  moved pages and PIMS APIs are gone; sign-in (SSO) and the 401 guard work; 40 endpoints used by the remaining
  pages × 2 users with no failures; bell; INCH data; stress-index preview + apply on a throw-away job
  (removed again); every table identical to before the test. PIMS re-tested afterwards: 15/15.

### After Phase B (2026-10-22)

- `linelist_lines` removed from ePULSE (user's decision): `ll-normalize` saves only to `line_list` (current
  lines) and `linelist_uploads` (upload log: revision numbers, who / when). The empty table was dropped and
  the three endpoints that only served it were removed (`/api/linelist/lines/:jobNo`,
  `/api/linelist/history/:jobNo`, `/api/linelist/export/:uploadId`); no page called them. Older revisions'
  lines can no longer be re-downloaded. `db/schema.sql` no longer creates it.
  PIMS (`D:\PIMS_APP`, database `PIMS_SQL`) keeps its own `linelist_lines` — not affected.
- **Stress Critical Line List Prep (`ll-stress`) moved to PIMS** (user's decision, replaces the earlier
  "cut the link"): page, `stressIndexController`, `stressIndexRoutes` and `css/ll-suite.css` restored in
  `D:\PIMS_APP` from `D:\PIMS_SQL` unchanged — uploads update PIMS_SQL's `stress_index` (553 lines) and mark
  ISO drawings critical again (PIMS_APP commit `087a034`). ePULSE: page and its 2 server files deleted, routes
  unmounted; gateway and old dashboard links open `:3400/ll-stress.html`. ePULSE's empty `stress_index` and
  `stress_lines` dropped; `schema.sql` no longer creates `stress_lines`. SSMS is unaffected (it reads PC-2's
  `stress_lines`). Data note: B378/101's index lists `P-101-12001` twice with two stress systems.

## 4. INCH data — ePULSE owns it, PIMS reads it live

Same pattern as the line list (ePULSE `line_list`, read live by SSMS).

1. **One-time copy:** `PIMS_SQL.inch_data` (9,324 rows) → ePULSE `inch_data` (empty today; same
   columns — both come from the same `inchController.js`). Verify row-by-row after copying.
2. **INCH Data Upload** (`inch-upload.html`) stays in ePULSE and keeps saving into ePULSE's `inch_data`.
3. **PIMS reads it live:** in `PIMS_SQL`, a postgres_fdw link to the ePULSE database
   (`EPULSE_DB_*` in PIMS's `.env`, a small `db/linkEpulse.js`, `npm run db:link-epulse`);
   rename the local table to `inch_data_before_link` (kept as backup) and create a read-only view
   `inch_data` over ePULSE's table — so PIMS code needs no change.
4. If the ePULSE database is unreachable, PIMS pages that use inch values (lots, dashboard, report,
   pre-checks) show them blank; the rest of PIMS works.

---

## 5. Not changing

GAD, line-list utilities, LMS, stress index, P&ID, Clash Report Upload, INCH Data Upload, the
single sign-on between ePULSE / MRCS / SSMS, and the MRCS / SSMS gateway links all stay in ePULSE.

---

## 6. Noted for the P&ID module (next)

All P&ID data is in the `PIMS_SQL` database (`pid_master_index` 174, `pid_documents` 5,
`pid_extracted_lines` 19, `pid_audit_log` 177); ePULSE's P&ID tables are empty. Since P&ID stays in
ePULSE, decide whether to copy that data into ePULSE or start fresh.
**Decided 2026-10-22: start fresh** — the user uploads correct data end to end. ePULSE's P&ID tables are empty;
the 5 leftover P&ID PDFs were removed from ePULSE's uploads (copies in `D:\PIMS_SQL` and the 2026-10-21 backup).

---

## Known bug (not part of the move)

`backend/controllers/gadController.js` lines 299 and 731 `require('../services/gadPreCheckService')`,
**which does not exist**. The error is silently swallowed (`catch (_) {}`), so GAD pre-checks never run.
Fix while testing GAD.
