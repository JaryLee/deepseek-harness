@echo off
rem DeepSeek Harness one-click launcher
rem Automatically checks dependencies and build artifacts, installs/builds if missing, then starts the Web UI.
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

rem Verify Node.js is available
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 22.19+ or 24.
    goto :fail
)

rem Resolve a working pnpm launcher: prefer corepack (bundled with Node), fall back to pnpm on PATH
set "PNPM_CMD="
call corepack pnpm --version >nul 2>nul
if not errorlevel 1 (
    set "PNPM_CMD=corepack pnpm"
) else (
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] No working pnpm found. Fix your pnpm install and run again.
        goto :fail
    )
    set "PNPM_CMD=pnpm"
)

rem Sync dependencies on every launch; pnpm skips quickly when the lockfile is unchanged
echo [INFO] Syncing dependencies ...
call %PNPM_CMD% install
if errorlevel 1 (
    echo [ERROR] pnpm install failed. Please check network or pnpm config.
    goto :fail
)

rem Build if the CLI artifact is missing
if not exist "apps\cli\lib\bin.js" (
    echo [INFO] Build artifacts not found, running %PNPM_CMD% run build ...
    call %PNPM_CMD% run build
    if errorlevel 1 (
        echo [ERROR] Build failed. See logs above.
        goto :fail
    )
)

echo [INFO] Starting DeepSeek Harness Web UI ...
echo [INFO] Open http://127.0.0.1:3080 in your browser.
echo [INFO] Close this window to stop the service.
echo.
call %PNPM_CMD% dsh web
if errorlevel 1 (
    echo.
    echo [ERROR] Service exited with code !errorlevel!
    goto :fail
)
goto :end

:fail
echo.
echo [ERROR] Startup aborted. Fix the issue above and run this script again.
pause
exit /b 1

:end
endlocal