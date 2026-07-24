@echo off
if exist "%~dp0examples\electron-app" (
    cd /d "%~dp0examples\electron-app"
) else (
    cd /d "%~dp0potree\examples\electron-app"
)
call npm start
