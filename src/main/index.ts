import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { buildContainer, type Container } from './composition';
import { registerIpcHandlers } from './ipc';

let container: Container | null = null;

// Portable build: electron-builder sets PORTABLE_EXECUTABLE_DIR to the folder that holds the
// .exe. We keep data there (scan history, screenshots) instead of %APPDATA%, so the app
// nie zostawiala sladow poza swoim katalogiem. Musi byc przed buildContainer (czyta userData).
const portableDir = process.env['PORTABLE_EXECUTABLE_DIR'];
if (portableDir) {
  app.setPath('userData', join(portableDir, 'wcag-auditor-data'));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d1117',
    title: 'WCAG 2.2 Auditor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  window.on('ready-to-show', () => window.show());

  // Open external links in the default browser, not in the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void window.loadURL(devUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  container = buildContainer();
  registerIpcHandlers(container);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void container?.session.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void container?.session.close();
});
