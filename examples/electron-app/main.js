const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { fileURLToPath } = require('url');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    }
  });

  const examplePath = path.join(__dirname, '..', 'multiple_pointclouds.html');
  win.loadFile(examplePath);

  // Open devtools for debugging
  // win.webContents.openDevTools();
}

// IPC handler: open native file/folder picker and return absolute cloud.js path (or null)
ipcMain.handle('open-pointcloud', async () => {
  // Allow picking a file or a directory. We'll accept common pointcloud entry points:
  // - Potree format: cloud.js (file) or a folder containing cloud.js
  // - Entwine EPT: ept.json (file) or a folder containing ept.json
  // - LAS/LAZ/COPC files (.las, .laz, .copc)
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select a pointcloud entry file (cloud.js, ept.json, .las/.laz/.copc)',
    properties: ['openFile'],
    // Allow selecting common pointcloud entry file extensions
    filters: [
      { name: 'Pointclouds', extensions: ['js', 'json', 'las', 'laz', 'copc'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (canceled || !filePaths || filePaths.length === 0) return null;

  let selected = filePaths[0];

  try{
    const stat = fs.statSync(selected);
    if(!stat.isFile()) return null;

    // Validate supported extensions
    const ext = path.extname(selected).toLowerCase();
    const acceptExt = ['.js', '.json', '.las', '.laz', '.copc'];
    if(!acceptExt.includes(ext)) return null;
  }catch(e){
    return null;
  }

  // Return a canonical file:// URL so the renderer can fetch resources reliably
  try{
    return pathToFileURL(selected).toString();
  }catch(e){
    return selected;
  }
});

// IPC: open a native profile window and forward serialized profile data
// (original implementation did not open a native profile window)

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: convert pointcloud using PotreeConverter2 (spawns child process)
ipcMain.handle('convert-pointcloud', async (event, options = {}) => {
  // options: { inputs: [fileUrlOrPath,...], version: '2.0'|'1.7' }
  const inputs = (options.inputs || []).map(p => {
    if(typeof p === 'string' && p.startsWith('file://')){
      try{ return fileURLToPath(p); }catch(e){ return p; }
    }
    return p;
  });

  if(inputs.length === 0) throw new Error('no input files');

  // choose converter executable (prefer 2.0)
  const repoRoot = path.join(__dirname, '..');
  const exe2 = path.join(__dirname, '..', '..', 'libs', 'PotreeConverter2', 'PotreeConverter.exe');
  const exe1 = path.join(__dirname, '..', '..', 'libs', 'PotreeConverter', 'PotreeConverter.exe');

  let exe = null;
  if(fs.existsSync(exe2)) exe = exe2;
  else if(fs.existsSync(exe1)) exe = exe1;
  else throw new Error('PotreeConverter executable not found');

  // compute output directory: sibling of first input with _converted suffix
  const firstInput = inputs[0];
  const parent = path.dirname(firstInput);
  const base = path.basename(firstInput, path.extname(firstInput));
  const outDir = path.join(parent, base + '_converted');

  // spawn converter
  const spawn = require('child_process').spawn;
  const params = [ ...inputs, '-o', outDir ];

  const proc = spawn(exe, params);

  // stream stdout/stderr to renderer via 'convert-progress' channel
  proc.stdout.on('data', (data) => {
    const msg = data.toString();
    try{ event.sender.send('convert-progress', { type: 'stdout', text: msg }); }catch(e){}
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    try{ event.sender.send('convert-progress', { type: 'stderr', text: msg }); }catch(e){}
  });

  return await new Promise((resolve, reject) => {
    proc.on('error', (err) => {
      try{ event.sender.send('convert-progress', { type: 'error', text: String(err) }); }catch(e){}
      reject(err);
    });

    proc.on('close', (code) => {
      const finishedMsg = `converter exited with code ${code}`;
      try{ event.sender.send('convert-progress', { type: 'close', text: finishedMsg }); }catch(e){}

      if(code !== 0){
        return reject(new Error(finishedMsg));
      }

      // determine returned file: prefer cloud.js then metadata.json
      const candidateCloud = path.join(outDir, 'cloud.js');
      const candidateMeta = path.join(outDir, 'metadata.json');

      if(fs.existsSync(candidateCloud)) return resolve(pathToFileURL(candidateCloud).toString());
      if(fs.existsSync(candidateMeta)) return resolve(pathToFileURL(candidateMeta).toString());

      // otherwise resolve with outDir
      return resolve(pathToFileURL(outDir).toString());
    });
  });
});
