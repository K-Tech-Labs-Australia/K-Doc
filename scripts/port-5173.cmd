@echo off
REM ============================================================================
REM @file scripts/port-5173.cmd
REM @purpose Probes TCP port 5173, captures the listening process ID, and verifies if it is K-Doc's Vite dev server.
REM @inputs None (probes TCP port 5173 via netstat and queries http://localhost:5173 via curl).
REM @outputs Process exit code (0: free, 1: K-Doc dev server, 2: foreign or unidentifiable process); echoes status line to stdout.
REM @functions None (standalone batch script).
REM @dataflow netstat -ano -> findstr LISTENING & :5173 -> HOLDER_PID extraction -> curl http://localhost:5173 -> findstr <title>K-Doc</title> -> status output & exit code.
REM @controlflow Probe port 5173 with netstat -> if HOLDER_PID empty goto :free -> verify curl -> if missing goto :unidentified -> fetch title -> if mismatch goto :foreign -> fall through to :kdoc.
REM @version 2
REM @date 2026-09-06
REM ============================================================================

REM Parenthesised blocks were removed because a REM-only else branch is a parse error
REM in cmd.exe (". was unexpected at this time"), and parenthesised blocks are fragile
REM around comments and redirection symbols. This file is written in the plainest
REM possible batch using label-and-goto throughout because it runs before anything
REM else can report a problem. setlocal is intentionally omitted: the script only
REM needs its exit code, so there is nothing to scope and the endlocal trap is removed.

set "HOLDER_PID="

REM Query TCP listening sockets on port 5173.
REM netstat is used rather than PowerShell's Get-NetTCPConnection because the launcher
REM deliberately avoids PowerShell, whose execution policy is the whole reason start.cmd is batch.
REM Name the variable HOLDER_PID, not PID — PID is close enough to a real environment variable to be worth avoiding.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:":5173 "') do set "HOLDER_PID=%%a"

REM Check whether a process was found listening on port 5173.
REM If HOLDER_PID is empty, port 5173 is free; branch to :free.
if "%HOLDER_PID%"=="" goto :free

REM Verify whether curl.exe is available on the system PATH.
where curl >nul 2>nul

REM An unidentifiable server is treated as somebody else's, because the safe error is refusing to touch it.
REM If curl is unavailable (errorlevel 1), branch to :unidentified.
if errorlevel 1 goto :unidentified

REM Request the root HTTP page and inspect for K-Doc's HTML title tag.
REM Identifying the server by what it serves rather than by process name is what
REM stops the launcher adopting an unrelated node.exe that happens to hold the port.
curl -s --max-time 2 http://localhost:5173 2>nul | findstr /c:"<title>K-Doc</title>" >nul

REM If findstr did not match the K-Doc title tag (errorlevel 1), port 5173 is held by another program.
if errorlevel 1 goto :foreign

REM Title matched <title>K-Doc</title>: fall through to :kdoc.
:kdoc
REM Branch: K-Doc's own dev server is already listening on port 5173.
echo [INFO] Reusing the K-Doc dev server already on port 5173 (PID %HOLDER_PID%).
exit /b 1

:free
REM Branch: Nothing is listening on port 5173.
echo [INFO] Port 5173 is free.
exit /b 0

:foreign
REM Branch: Port 5173 is occupied by a foreign application.
echo [ERROR] Port 5173 is held by another program (PID %HOLDER_PID%).
exit /b 2

:unidentified
REM Branch: Port 5173 is in use, but curl is unavailable to verify server identity.
echo [ERROR] Port 5173 is in use (PID %HOLDER_PID%) and curl is unavailable to identify it.
exit /b 2
