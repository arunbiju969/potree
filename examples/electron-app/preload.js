const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openPointcloud: () => ipcRenderer.invoke('open-pointcloud'),

    // convertPointcloud: invokes main process to run PotreeConverter and returns file:// URL of result
    convertPointcloud: (options) => ipcRenderer.invoke('convert-pointcloud', options),

    // subscribe to converter progress messages
    onConvertProgress: (cb) => {
        ipcRenderer.on('convert-progress', (event, data) => {
            try{ cb(data); }catch(e){}
        });
    }
});
