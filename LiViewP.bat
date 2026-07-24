@echo off
setlocal enableextensions

echo [1/4] Checking Node.js environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not found in system PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed or not found in system PATH.
    echo Please install Node.js/npm and try again.
    pause
    exit /b 1
)

echo [2/4] Checking core Potree build folder...
if not exist "%~dp0build\potree\potree.js" (
    echo [INFO] Potree build folder is missing. Building Potree core library...
    pushd "%~dp0"
    call npm install
    popd
    if not exist "%~dp0build\potree\potree.js" (
        echo [ERROR] Failed to build Potree core library.
        pause
        exit /b 1
    )
)

echo [3/4] Locating application directory...
if exist "%~dp0examples\electron-app" (
    cd /d "%~dp0examples\electron-app"
) else if exist "%~dp0potree\examples\electron-app" (
    cd /d "%~dp0potree\examples\electron-app"
) else (
    echo [ERROR] Could not locate examples\electron-app directory.
    pause
    exit /b 1
)

echo [4/4] Checking project dependencies...
if not exist "node_modules" (
    echo [INFO] Node modules missing. Running 'npm install'...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] 'npm install' failed. Please check your internet connection or npm logs.
        pause
        exit /b 1
    )
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo [INFO] Electron binary missing or incomplete. Setting up Electron binary...
    node -e "const { version } = require('./node_modules/electron/package'); const { downloadArtifact } = require('@electron/get'); const child_process = require('child_process'); const path = require('path'); const fs = require('fs'); (async () => { const zipPath = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: process.arch }); const targetDir = path.resolve(__dirname, 'node_modules', 'electron', 'dist'); if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true }); child_process.execSync('powershell -Command \"Expand-Archive -Path \'' + zipPath + '\' -DestinationPath \'' + targetDir + '\' -Force\"'); fs.writeFileSync(path.join(__dirname, 'node_modules', 'electron', 'path.txt'), 'electron.exe'); console.log('[INFO] Electron binary successfully configured.'); })().catch(err => { console.error('[ERROR] Failed to set up Electron:', err.message); process.exit(1); });"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to setup Electron binary.
        pause
        exit /b 1
    )
)

echo [INFO] Dependencies verified. Starting Potree Electron...
call npm start


