@echo off
REM ============================================================
REM  ePULSE production - STEP 2: live link to the office PIMS server
REM  Creates the read-only links (users, projects, units, SGLs, roles) to
REM  eil_employees and cmp_pims_1014 on the PIMS server named in backend\.env.
REM  A dry run goes first; nothing is changed unless it ends with "Dry run OK".
REM  Run it again whenever the PIMS server address or password changes.
REM ============================================================
setlocal
set "ROOT=%~dp0..\.."
set "NODE=%ROOT%\backend\node-v22.19.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "%ROOT%\backend\.env" goto :noenv

pushd "%ROOT%\backend"
echo --- Dry run ---
set "DRY_RUN=1"
"%NODE%" db\linkPc2.js
if errorlevel 1 goto :dryfail
set "DRY_RUN="
echo --- Linking for real ---
"%NODE%" db\linkPc2.js
if errorlevel 1 goto :fail
popd
echo STEP 2 done. Next: step3_start_epulse.bat
exit /b 0

:noenv
echo backend\.env not found - copy deploy\production\env.production.template to backend\.env and fill it.
exit /b 1

:dryfail
popd
echo Dry run FAILED - check the PIMS server address and password in backend\.env, and that the
echo PIMS server lets this machine in: pg_hba.conf + firewall, see deploy\PRODUCTION_INSTALL.md
exit /b 1

:fail
popd
echo Linking FAILED - see the error above.
exit /b 1
