@echo off
REM ============================================================
REM  ePULSE production - STEP 3: start the server (port from backend\.env, 3300)
REM  Keep this window open; closing it stops ePULSE. To run it in the
REM  background / at boot, use the same method as the other modules on this server.
REM ============================================================
setlocal
set "ROOT=%~dp0..\.."
set "NODE=%ROOT%\backend\node-v22.19.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=node"
title ePULSE v1.0.0
pushd "%ROOT%\backend"
"%NODE%" server.js
popd
endlocal
