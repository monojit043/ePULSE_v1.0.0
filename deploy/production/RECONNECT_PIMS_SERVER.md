# Reconnect ePULSE to the PIMS server (when PC-2 changes)

ePULSE (office PC-1, `E:\ePULSE_v1.0.0`, port 3000) reads logins, projects, units and roles **live** from the
PIMS server (office PC-2) — databases `eil_employees` and `pims`. Nothing is copied, so when PC-2 changes,
only the **link** has to be pointed at it again. No code changes, no data to move.

Current setup (2026-10-30): PC-1 = **10.40.36.232**, PC-2 = **10.40.36.206**, login `postgres`, port 5432.

---

## Which case is it?

| What changed | Do |
|---|---|
| PC-2's **IP** changed | Part A on PC-2 (only if PC-2 was rebuilt), then Part B on PC-1 |
| PC-2's **postgres password** changed | Part B on PC-1 (steps B3–B5) |
| PC-2 **replaced by a new server** | Part A on the new server, then Part B on PC-1 |
| A database **renamed** (`eil_employees` / `pims`) | Part B on PC-1 (names in B3) |
| **PC-1's** IP changed | Part A on PC-2 with the new PC-1 IP (A2 + A3), then B5 on PC-1 |

---

## Part A — on PC-2 (the PIMS server): let PC-1 in

Skip any item that is already in place.

**A1. PostgreSQL listens on the network.** In DBeaver on PC-2: `SHOW listen_addresses;` must be `*`.
If not: set `listen_addresses = '*'` in `postgresql.conf` (same folder as `pg_hba.conf`) and restart the PostgreSQL service.

**A2. `pg_hba.conf` allows PC-1.**
1. In DBeaver on PC-2: `SHOW hba_file;` → the file's path (usually `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf`).
2. Notepad **as Administrator** → open that file → add at the bottom (PC-1's IP, keep `/32`):
   ```
   host    eil_employees,pims    postgres    <PC-1 IP>/32    scram-sha-256
   ```
3. Save, then in DBeaver:
   ```sql
   SELECT pg_reload_conf();
   SELECT line_number, database, user_name, address, error FROM pg_hba_file_rules WHERE address = '<PC-1 IP>';
   ```
   The line must show with `error` empty. (If PC-1's IP changed, edit the old line instead of adding a new one.)

**A3. Firewall allows PC-1** (Command Prompt **as Administrator** on PC-2):
```bat
netsh advfirewall firewall add rule name="PostgreSQL - ePULSE (PC-1)" dir=in action=allow protocol=TCP localport=5432 remoteip=<PC-1 IP>
```
If the rule already exists and only PC-1's IP changed:
```bat
netsh advfirewall firewall set rule name="PostgreSQL - ePULSE (PC-1)" new remoteip=<PC-1 IP>
```

---

## Part B — on PC-1 (`E:\ePULSE_v1.0.0`): point ePULSE at PC-2

**B1. Can PC-1 reach PC-2?** (PowerShell)
```powershell
Test-NetConnection <PC-2 IP> -Port 5432
```
`TcpTestSucceeded : True` → go on. `False` → Part A3 (firewall) or wrong IP / port.

**B2. Can PC-1 log in to both databases?** (Command Prompt; asks for PC-2's postgres password)
```bat
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h <PC-2 IP> -U postgres -d eil_employees -c "select count(*) from users"
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h <PC-2 IP> -U postgres -d pims -c "select count(*) from projects"
```

| Error | Fix |
|---|---|
| `Connection timed out` | firewall on PC-2 (A3) / wrong IP |
| `no pg_hba.conf entry for host "<PC-1 IP>"` | A2, then `SELECT pg_reload_conf();` |
| `password authentication failed` | wrong password |
| `database ... does not exist` | database name differs — use the real name in B3 |

**B3. Edit `E:\ePULSE_v1.0.0\backend\.env`** (Notepad) — only these lines:
```
EMP_DB_HOST=<PC-2 IP>
EMP_DB_NAME=eil_employees
EMP_DB_USER=postgres
EMP_DB_PASSWORD=<PC-2 postgres password>

PIMS_DB_HOST=<PC-2 IP>
PIMS_DB_NAME=pims
PIMS_DB_USER=postgres
PIMS_DB_PASSWORD=<PC-2 postgres password>
```

**B4. Stop ePULSE** — close the "ePULSE v1.0.0" window (step 3).

**B5. Re-link** — double-click `deploy\production\step2_link_pims_server.bat`. Expected:
```
✅ Dry run OK — nothing changed. Live counts would be: { users: …, projects: …, … }
✅ Linked to PC-2 (<PC-2 IP>) — live counts: { … }
```
If the dry run fails, nothing was changed — fix the cause (B1 / B2) and run it again.

**B6. Start ePULSE** — double-click `deploy\production\step3_start_epulse.bat`. It must show
`✅ PC-2 live link OK — Users: … | Projects: …`, then open `http://<PC-1 IP>:3000/gateway-login.html` and log in.

---

## Notes

- **Never** run `step1_create_database.bat` again — the ePULSE database and its data stay as they are.
- Nothing in ePULSE's own data refers to PC-2's IP; only the link does. Re-linking loses nothing.
- Modules that read PC-2 **through ePULSE** (IPMCS, SIMS) need nothing. Modules with their **own** PC-2 link
  (SSMS, MRCS) need the same B3 + `npm run db:link-pc2` in their own folder once they are in production.
- Keep the old PC-2's `pg_hba.conf` line / firewall rule removed when it is retired.
