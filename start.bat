@echo off
rem Starts Discindex on this computer and opens it in your browser.
rem Keep this window open while you use the site. Close it to stop.
cd /d "%~dp0"
echo.
echo   Discindex is running at http://localhost:8000
echo   Keep this window open. Close it to stop the site.
echo.
start "" http://localhost:8000
python -m http.server 8000 --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Python was not found. Install it from https://www.python.org/downloads/ and try again.
  pause
)
