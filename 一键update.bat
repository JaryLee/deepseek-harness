@echo off
rem DeepSeek Harness one-click update
rem Stashes local changes, pulls the latest code, restores local changes,
rem then syncs dependencies and rebuilds so the app can start cleanly.
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

rem Verify git is available
where git >nul 2>nul
if errorlevel 1 goto :nogit

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

rem Detect whether there are local changes (tracked files)
set "STASHED=0"
set "NEED_RELOCK=0"
git diff --quiet --ignore-submodules HEAD
if errorlevel 1 set "STASHED=1"

rem Stash local changes if present so the pull is clean
if "!STASHED!"=="1" (
    echo [INFO] Local changes detected, stashing before pull ...
    git stash push -m "dsh-update-before-pull"
    if errorlevel 1 goto :stashfail
)

rem Pull the latest code (fast-forward only)
echo [INFO] Pulling latest code from origin/master ...
git pull --ff-only
if errorlevel 1 goto :pullfailed

rem Restore local changes if they were stashed
if "!STASHED!"=="1" (
    echo [INFO] Restoring local changes ...
    git stash pop
    if errorlevel 1 goto :popconflict
)

rem Sync dependencies (pnpm skips quickly when the lockfile is unchanged)
:sync_deps
echo [INFO] Syncing dependencies ...
set "INSTALL_FROZEN=1"
if "!NEED_RELOCK!"=="1" set "INSTALL_FROZEN=0"
call :run_install
if errorlevel 1 goto :fail
goto :deps_done

rem Single-line ifs avoid the cmd.exe parse failure that nested if-blocks
rem containing `call` trigger. run_install retries against the lockfile when
rem the frozen install fails (outdated lockfile or local packages not yet in it).
:run_install
if "!INSTALL_FROZEN!"=="1" call %PNPM_CMD% install
if "!INSTALL_FROZEN!"=="0" call %PNPM_CMD% install --no-frozen-lockfile
if not errorlevel 1 exit /b 0
echo [WARN] Frozen install failed; retrying with --no-frozen-lockfile ...
call %PNPM_CMD% install --no-frozen-lockfile
if not errorlevel 1 exit /b 0
echo [ERROR] pnpm install failed. Please check network or pnpm config.
exit /b 1

:deps_done
rem Rebuild every time: a pull can change sources while stale/missing lib/ artifacts
rem remain (e.g. missing typert.host.js or client bundles), which breaks launch.
rem start.bat only builds when apps\cli\lib\bin.js is absent, so it cannot catch this.
echo [INFO] Rebuilding all packages ...
call %PNPM_CMD% run build
if errorlevel 1 (
    echo [ERROR] Build failed. See logs above.
    goto :fail
)

echo.
echo [INFO] Update complete. Run start.bat to launch the app.
goto :end

:nogit
echo [ERROR] git not found. Please install git.
goto :fail

:stashfail
echo [ERROR] Failed to stash local changes. Aborting update.
goto :fail

:pullfailed
echo [ERROR] git pull failed. Restoring local changes ...
if "!STASHED!"=="1" git stash pop >nul 2>nul
goto :fail

:popconflict
echo [WARN] Conflict while restoring local changes on pnpm-lock.yaml.
echo [INFO] Upstream moved the lockfile; using it as base and regenerating it from package.json ...
git checkout --ours -- pnpm-lock.yaml 2>nul
if errorlevel 1 git checkout HEAD -- pnpm-lock.yaml 2>nul
git add pnpm-lock.yaml
set "NEED_RELOCK=1"
goto :sync_deps

:fail
echo.
echo [ERROR] Update aborted. Fix the issue above and run this script again.
pause
exit /b 1

:end
endlocal
