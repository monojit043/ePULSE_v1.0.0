# ePULSE v1.0.0 — Production install (fresh, empty database)

Production mirrors development exactly:

| Development | Production (office) | Holds |
|---|---|---|
| PC-1 (`D:\ePULSE_DEV_v1.0.0`, port 3000) | **Office apps server** | ePULSE code + its own database `ePULSE_v1.0.0` |
| PC-2 | **Office PIMS server** | `eil_employees` (logins), `cmp_pims_1014` (projects, units, roles) — ePULSE only **reads** them, live |

ePULSE starts **empty** in production: no line list, P&IDs, GAD, clash or inch data are carried over.
Users, projects, units and roles are not copied either — they are read live from the PIMS server.

Everything below was rehearsed on PC-1 on 2026-10-26: the database built by step 1 + step 2 is identical
to development (685 of 685 structure items), has 0 rows, and the server starts and serves every page.

---

## What is in the package

```
ePULSE_v1.0.0\
  backend\                      server code
    node_modules\               all libraries, ready (no "npm install" needed)
    node-v22.19.0-win-x64\      Node.js runtime used by the scripts (no Node install needed)
    db\production_schema.sql    the empty database structure (25 tables)
    uploads\                    empty — uploaded P&IDs, GADs etc. are stored here
  public\                       web pages
  deploy\
    PRODUCTION_INSTALL.md       this guide
    production\
      env.production.template   → becomes backend\.env
      step1_create_database.bat
      step2_link_pims_server.bat
      step3_start_epulse.bat
```

---

## Part A — on the office PIMS server (one time)

ePULSE on the apps server must be allowed to read two databases here. Skip any item that is already
in place. Use the **apps server's IP** below (example `10.40.36.130`).

1. `C:\Program Files\PostgreSQL\18\data\postgresql.conf` → make sure `listen_addresses = '*'`
2. `C:\Program Files\PostgreSQL\18\data\pg_hba.conf` → add at the bottom (one line, **with the `/32`** mask):
   ```
   host    all    all    <apps server IP>/32    scram-sha-256
   ```
   A line without a mask breaks the whole file and stops PIMS itself. Save as UTF-8, same file name.
3. Firewall (Command Prompt **as administrator**):
   ```bat
   netsh advfirewall firewall add rule name="PostgreSQL 5432 - ePULSE" dir=in action=allow protocol=TCP localport=5432 remoteip=<apps server IP>
   ```
4. Restart PostgreSQL (as administrator): `net stop postgresql-x64-18` then `net start postgresql-x64-18`
5. *(Recommended)* use a read-only PostgreSQL login for ePULSE instead of `postgres`.

Check from the **apps server**:
```bat
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h <PIMS server IP> -U postgres -d eil_employees -c "select count(*) from users"
```
It must print a number. If it hangs → firewall; if it says `no pg_hba.conf entry` → step 2.

---

## Part B — on the office apps server

### B1. Copy the files
Unzip the package to the production folder, e.g. `E:\ePULSE_v1.0.0`
(any folder works; the scripts find everything relative to themselves).

### B2. Settings — `backend\.env`
Copy `deploy\production\env.production.template` to `backend\.env` and fill every `<...>`:

| Setting | Value |
|---|---|
| `DB_PASSWORD` | postgres password of **this** (apps) server |
| `EMP_DB_HOST`, `PIMS_DB_HOST` | IP of the **office PIMS server** |
| `EMP_DB_PASSWORD`, `PIMS_DB_PASSWORD` | postgres password of the PIMS server |
| `SESSION_SECRET` | new random value (command in the template) |
| `SSO_SECRET` | new random value — **keep it**: every production module (MRCS, SSMS, IPMCS) must later use the same one |

Leave `DB_NAME=ePULSE_v1.0.0` and `PORT=3000` unless 3000 is already taken on this server.

### B3. Create the empty database
Double-click **`deploy\production\step1_create_database.bat`** (it asks for the postgres password).
Expected: `25 tables created`. If the database already exists it stops and changes nothing.

### B4. Link to the PIMS server
Double-click **`deploy\production\step2_link_pims_server.bat`**.
Expected: `✅ Dry run OK`, then `✅ Linked to PC-2 (<PIMS server IP>)` with live counts
(users, projects, units …). If the dry run fails, nothing was changed — fix Part A / `.env` and run it again.

### B5. Open port 3000 on the apps server (once, as administrator)
```bat
netsh advfirewall firewall add rule name="ePULSE 3000" dir=in action=allow protocol=TCP localport=3000
```

### B6. Start
Double-click **`deploy\production\step3_start_epulse.bat`**. Expected:
```
✅ PostgreSQL connected — DB: ePULSE_v1.0.0
✅ PC-2 live link OK — Users: <n> | Projects: <n>
🚀 ePULSE Server started
```
Keep the window open (closing it stops ePULSE). To run it in the background / start with Windows,
use the same method the server already uses for MRCS and SSMS.

### B7. Check
From any office PC: `http://<apps server IP>:3000/gateway-login.html`
- log in with a PIMS employee ID — the gateway opens with that person's jobs/units
- open Line List → Normalize, P&ID Index, GAD — pages load and lists are empty
- upload one test P&ID index / line list and see it appear

---

## Notes

- **Run step 1 and step 2 only once.** The `npm run db:migrate` / `db:migrate-gad` scripts are for
  development; do not run them on production.
- **Later code updates:** copy the new code over the folder (keep `backend\.env` and `backend\uploads\`),
  then restart with step 3. If an update changes the database, it will come with its own instructions.
- **PIMS server address or password changes:** edit `backend\.env`, run step 2 again, restart. No code changes.
- **Gateway links** to SSMS (4000), MRCS (5500), MTO/IPMCS (8090) and PIMS (3400) open the same server on
  those ports — they work once those modules are deployed here too.
- **Backups:** back up the database (`pg_dump -Fc -d ePULSE_v1.0.0`) and the `backend\uploads\` folder together.
- **Undo a failed install:** stop the server, `dropdb -U postgres ePULSE_v1.0.0`, delete the folder,
  start again from B1. Nothing on the PIMS server is ever written by ePULSE.
