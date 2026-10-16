const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixture', { invoke: (channel, args) => ipcRenderer.invoke(channel, args) });
