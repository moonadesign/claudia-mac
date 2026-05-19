const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadGoodies: () => ipcRenderer.invoke('goodies:load'),
  loadHome: () => ipcRenderer.invoke('home:load'),
  onHomeUpdate: cb => ipcRenderer.on('home:update', (_, d) => cb(d)),
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  loadRules: () => ipcRenderer.invoke('rules:load'),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  loadStats: () => ipcRenderer.invoke('stats:load'),
  loadTools: () => ipcRenderer.invoke('tools:load'),
  setGoodies: goodies => ipcRenderer.invoke('goodies:set', goodies),
  setTheme: mode => ipcRenderer.invoke('theme:set', mode),
})
