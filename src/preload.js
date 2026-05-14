const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadHome: () => ipcRenderer.invoke('home:load'),
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  loadRules: () => ipcRenderer.invoke('rules:load'),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  loadStats: () => ipcRenderer.invoke('stats:load'),
  loadTools: () => ipcRenderer.invoke('tools:load'),
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
})
