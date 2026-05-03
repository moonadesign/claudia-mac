const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
})
