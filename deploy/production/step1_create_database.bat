@echo off
REM ============================================================
REM  ePULSE production - STEP 1: create the EMPTY database
REM  Creates database ePULSE_v1.0.0 and loads backend\db\production_schema.sql
REM  (25 empty tables). Stops without touching anything if the database exists.
REM  PostgreSQL asks for the postgres password (hidden) a few times.
REM ============================================================
setlocal
set "PGBIN=C:\Program Files\PostgreSQL\18\bin"
set "DBNAME=ePULSE_v1.0.0"
set "PGUSER=postgres"
set "ROOT=%~dp0..\.."

if not exist "%PGBIN%\psql.exe" (
  echo PostgreSQL 18 not found in "%PGBIN%" - edit PGBIN at the top of this file.
  exit /b 1
)

"%PGBIN%\psql.exe" -U %PGUSER% -d postgres -tAc "SELECT 'EXISTS' FROM pg_database WHERE datname='%DBNAME%'" | findstr EXISTS >nul
if not errorlevel 1 (
  echo Database "%DBNAME%" already exists - stopped, nothing was changed.
  exit /b 1
)

echo Creating database "%DBNAME%" ...
"%PGBIN%\createdb.exe" -U %PGUSER% "%DBNAME%" || exit /b 1

echo Loading the structure (25 empty tables) ...
"%PGBIN%\psql.exe" -U %PGUSER% -d "%DBNAME%" -v ON_ERROR_STOP=1 -q -f "%ROOT%\backend\db\production_schema.sql" >nul || (
  echo FAILED loading production_schema.sql - see the error above.
  exit /b 1
)

"%PGBIN%\psql.exe" -U %PGUSER% -d "%DBNAME%" -tAc "SELECT count(*) || ' tables created' FROM pg_tables WHERE schemaname='public'"
echo STEP 1 done. Next: fill backend\.env, then run step2_link_pims_server.bat
endlocal
