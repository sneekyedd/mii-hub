@echo off
rem Starts MiiNSCC: quietly gets the latest version first, then opens it in your browser.
rem (Double-click this instead of index.html. If there's no internet, it just opens the copy you have.)
cd /d "%~dp0"
where git >nul 2>nul && git pull --ff-only --quiet >nul 2>nul
start "" "%~dp0index.html"
