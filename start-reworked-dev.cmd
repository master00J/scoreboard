@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "ARENACUE_SKIP_LICENSE_GATE=1"
set "ARENACUE_USER_DATA_DIR=%~dp0dev-user-data"
cd /d "%~dp0"
call npm.cmd run dev > "%~dp0dev-launch.log" 2>&1
endlocal
