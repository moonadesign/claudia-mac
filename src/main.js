const { app, BrowserWindow, globalShortcut, ipcMain, Menu, MenuItem, nativeTheme, screen } = require('electron')
const path = require('path')

let win

const createWindow = () => {
  const { x: wx, y: wy, height: sh, width: sw } = screen.getPrimaryDisplay().workArea
  const h = sh >= 1024 ? 1024 : 720
  const w = sw >= 1440 ? 1440 : 1280
  win = new BrowserWindow({
    height: h,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    width: w,
    x: wx + Math.round((sw - w) / 2),
    y: wy + Math.round((sh - h) / 2),
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.on('context-menu', (_, p) => {
    const menu = new Menu()
    menu.append(new MenuItem({ click: () => win.webContents.inspectElement(p.x, p.y), label: 'Inspect Element' }))
    menu.popup()
  })
  globalShortcut.register('CommandOrControl+Option+I', () => win.webContents.toggleDevTools())
}

app.setName('Minterface')
app.dock.setIcon(path.join(__dirname, '..', 'minterface-icon.png'))
app.whenReady().then(createWindow)

ipcMain.handle('theme:set', (_, mode) => { nativeTheme.themeSource = mode })
