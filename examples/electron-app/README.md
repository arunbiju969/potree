Quick start

1. cd into the example directory:

```powershell
cd examples/electron-app
```

2. Install dev dependencies (Electron):

```powershell
npm install
```

3. Run the app:

```powershell
npm start
```

Notes
- This loads `examples/multiple_pointclouds.html` from the repository root. Make sure you run `npm install` in the `examples/electron-app` folder so Electron is available locally.
- The BrowserWindow disables nodeIntegration and enables contextIsolation for basic security. If you need to enable node features inside the page, adjust `webPreferences` in `main.js` accordingly.
