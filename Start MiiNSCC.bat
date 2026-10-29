@echo off
rem Starts MiiNSCC: quietly gets the latest version first, then opens it in your browser.
rem (Double-click this instead of index.html. If there's no internet, it just opens the copy you have.)
rem (remember this folder first: Windows can lose track of it after changing folders)
set "HERE=%~dp0"
cd /d "%HERE%"
rem find Git (by name, or in its usual install folders: Windows doesn't always know it by name)
set "GIT=git"
where git >nul 2>nul || set "GIT="
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
if not defined GIT if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "GIT=%LocalAppData%\Programs\Git\cmd\git.exe"
if defined GIT "%GIT%" pull --ff-only --quiet >nul 2>nul
start "" "%HERE%index.html"
