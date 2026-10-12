@echo off
setlocal

REM ============================================================================
REM @file start.cmd
REM @purpose Windows batch launcher and preflight runner for K-Doc desktop app.
REM @inputs Optional command-line argument (%1): 'dev' (default), 'build', or 'test'.
REM @outputs Process exit code (0 on success, non-zero on failure); application, build, or test outputs on stdout/stderr.
REM @dataflow User/Explorer invocation -> argument validation -> preflight dependency checks -> command execution -> exit code propagation.
REM @controlflow Resolve repository root -> parse mode argument -> verify Node.js installed -> verify/install npm dependencies -> verify/fetch dictionary -> verify Rust toolchain (for dev/build) -> execute requested mode -> pause on failure -> exit.
REM @version 1
REM @date 2026-09-06
REM ============================================================================

REM K-Doc is a Windows-only desktop application (Tauri v2 + WebView2). A classic .cmd
REM batch file is intentionally used instead of PowerShell because default Windows
REM installations enforce an execution policy (e.g. Restricted or RemoteSigned) that
REM blocks unsigned .ps1 scripts when double-clicked by end users. Using a batch script
REM guarantees that a fresh clone opens seamlessly on any stock Windows machine without
REM requiring elevated administrative permissions or execution policy reconfiguration.

REM Change current working directory to the repository root where this script resides.
REM Windows Explorer starts a batch file in an arbitrary working directory (typically
REM C:\Windows\System32 or the user profile folder), so a script that assumes the
REM repository root fails exactly when a non-developer runs it — which is the primary
REM audience and use case this launcher exists for.
pushd "%~dp0"

REM ----------------------------------------------------------------------------
REM Argument Parsing & Validation
REM ----------------------------------------------------------------------------

REM Check whether a mode argument (%1) was provided on the command line.
REM If no argument was supplied, default to 'dev' mode for standard local development.
set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"

REM Check whether the requested mode matches 'dev', 'build', or 'test' (case-insensitive).
REM If valid, branch to preflight checks; otherwise, display usage instructions and exit 1.
if /i "%MODE%"=="dev" goto :preflight
if /i "%MODE%"=="build" goto :preflight
if /i "%MODE%"=="test" goto :preflight

REM Unrecognized mode argument: display usage instructions and terminate with failure code 1.
echo [ERROR] Unrecognized mode "%MODE%".
echo.
echo Usage: %~nx0 [dev ^| build ^| test]
echo.
echo Modes:
echo   dev   - Launch K-Doc in development mode with live reload (default)
echo   build - Build a production release desktop bundle
echo   test  - Run Vitest and Rust test suites
cmd /c "exit /b 1"
goto :exit_script

REM ----------------------------------------------------------------------------
REM Preflight Checks
REM ----------------------------------------------------------------------------
:preflight

REM Preflight Check 1: Verify Node.js presence.
REM Naming the fix rather than only the failure is the difference between an error
REM a user can act on and one they cannot.
where node >nul 2>nul
REM Check whether 'where node' located node on PATH (errorlevel 0).
REM If Node.js is missing, display actionable remediation instructions and abort with exit code 1.
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not found on PATH.
    echo Node.js 20+ is required to build and run K-Doc.
    echo Please install Node.js from https://nodejs.org and rerun this script.
    cmd /c "exit /b 1"
    goto :exit_script
)

REM Preflight Check 2: Verify npm dependencies.
REM Check whether the 'node_modules' directory exists.
REM This is checked rather than always run because 'npm install' on an up-to-date tree
REM still costs several seconds on every launch, degrading the instant-start experience.
if not exist "node_modules" (
    echo [INFO] node_modules not found. Running npm install...
    call npm install
    REM Check whether 'npm install' succeeded (errorlevel 0).
    REM If installation failed, abort the script and propagate failure.
    if errorlevel 1 (
        echo [ERROR] 'npm install' failed. Please check your network connection and npm configuration.
        goto :exit_script
    )
)

REM Preflight Check 3: Verify Hunspell dictionary assets.
REM Check whether the en-GB Hunspell dictionary index file exists.
REM If missing, run 'npm run fetch-dictionary' to download index.aff and index.dic.
if not exist "packages\app\public\dictionaries\en-GB\index.dic" (
    echo [INFO] English dictionary not found. Fetching dictionary assets...
    call npm run fetch-dictionary
    REM Check whether 'npm run fetch-dictionary' succeeded.
    REM If download fails, warn and continue rather than aborting: spell check in K-Doc
    REM degrades gracefully to drawing nothing when the dictionary is absent, so a temporary
    REM network failure must not stop the editor from opening.
    if errorlevel 1 (
        echo [WARN] Failed to fetch dictionary assets.
        echo [WARN] Spell checking will be unavailable until 'npm run fetch-dictionary' succeeds.
        echo [WARN] Continuing launch without offline dictionary...
        REM Reset errorlevel to 0 so this non-fatal warning does not cause the launcher to fail.
        cmd /c "exit /b 0"
    )
)

REM Preflight Check 4: Verify Rust toolchain (cargo) for dev and build modes.
REM Check whether the current mode requires the Rust toolchain (dev or build).
REM dev and build compile the Tauri native host via Cargo; test mode skips this preflight
REM because Vitest runs first and tests core TypeScript packages independently.
if /i not "%MODE%"=="test" (
    where cargo >nul 2>nul
    REM Check whether 'where cargo' located Cargo on PATH (errorlevel 0).
    REM If absent, notify the user that the Tauri build needs Rust and abort with exit code 1.
    if errorlevel 1 (
        echo [ERROR] Cargo / Rust toolchain was not found on PATH.
        echo The Tauri build needs the Rust toolchain.
        echo Please install Rust from https://rustup.rs and rerun this script.
        cmd /c "exit /b 1"
        goto :exit_script
    )
)

REM ----------------------------------------------------------------------------
REM Mode Execution
REM ----------------------------------------------------------------------------

REM Check which mode was selected and branch to its execution block.
if /i "%MODE%"=="dev" goto :mode_dev
if /i "%MODE%"=="build" goto :mode_build
if /i "%MODE%"=="test" goto :mode_test

:mode_dev
REM Probe port 5173 to check if a dev server is already running or if the port is held by another process.
call scripts\port-5173.cmd

REM Branch on errorlevel in descending numerical order (2, then 1).
REM In Windows batch, 'if errorlevel N' tests whether the exit code is N or greater.
REM Descending order is mandatory because testing a lower number first would trigger
REM prematurely for any higher exit code (e.g. errorlevel 1 would match exit code 2).
if errorlevel 2 goto :dev_port_conflict
if errorlevel 1 goto :dev_attach

REM Exit code 0: Port 5173 is free; fall through to the normal dev server launch.
echo [INFO] Starting K-Doc development shell...
call npm run tauri dev
REM Check whether 'npm run tauri dev' exited cleanly or with an error.
if errorlevel 1 goto :dev_failed
goto :exit_script

:dev_attach
REM Exit code 1: K-Doc's own dev server is already listening on port 5173.
REM Pass the tauri-attach.json config overlay to blank beforeDevCommand so Tauri attaches
REM to the running server instead of starting a second one on a port that is already taken.
call npm run tauri dev -- --config scripts/tauri-attach.json
REM Check whether 'npm run tauri dev' exited cleanly or with an error.
if errorlevel 1 goto :dev_failed
goto :exit_script

:dev_port_conflict
REM Exit code 2: Another program holds port 5173 or the listener is unidentifiable.
REM The launcher will not touch a port it does not own. The port probe above named the owning process.
echo [ERROR] Port 5173 is not owned by K-Doc. The launcher will not touch a port it does not own.
echo [ERROR] Please stop the process identified above or free port 5173 before launching K-Doc.
cmd /c "exit /b 1"
goto :exit_script

:dev_failed
REM Development shell exited with an error.
echo [ERROR] Development shell exited with an error.
goto :exit_script

:mode_build
REM Build the production release desktop application bundle.
echo [INFO] Building K-Doc release bundle...
call npm run tauri build
REM Check whether 'npm run tauri build' succeeded.
REM If the build failed, propagate errorlevel to exit handling; if successful, print bundle destination.
if errorlevel 1 (
    echo [ERROR] Release build failed.
    goto :exit_script
)
REM Print where the installer and release binaries land upon successful build completion.
echo.
echo [INFO] Release build completed successfully!
echo Installer and bundle artifacts land in:
echo   src-tauri\target\release\bundle\
goto :exit_script

:mode_test
REM Run both test suites in sequence: Vitest (packages/) then Rust (src-tauri/).
echo [INFO] Running JavaScript/TypeScript test suite (Vitest)...
call npm test
REM Check whether the JavaScript/TypeScript test suite passed.
REM If Vitest tests failed, abort immediately before executing the Rust test suite.
if errorlevel 1 (
    echo [ERROR] JavaScript/TypeScript test suite failed. Aborting before Rust test suite.
    goto :exit_script
)

echo.
echo [INFO] Running Rust test suite (cargo test)...
call npm run test:rust
REM Check whether the Rust test suite passed.
REM If Rust tests failed, propagate errorlevel to exit handling.
if errorlevel 1 (
    echo [ERROR] Rust test suite failed.
    goto :exit_script
)
goto :exit_script

REM ----------------------------------------------------------------------------
REM Exit Handling & Directory Cleanup
REM ----------------------------------------------------------------------------
:exit_script

REM Check errorlevel to determine if pause is needed on failure.
REM Because a double-clicked window vanishes on exit, pause only when the script failed.
REM Pausing on success would leave a dead console window open behind a running app,
REM while not pausing on failure hides the very message the user needs to troubleshoot.
if errorlevel 1 (
    echo.
    echo [ERROR] Launcher terminated with error code %ERRORLEVEL%.
    pause
)

popd
exit /b %ERRORLEVEL%
