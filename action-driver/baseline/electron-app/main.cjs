const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 900, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  return window.loadURL('about:blank');
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
