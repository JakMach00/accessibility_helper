import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/ipc';

export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menuOpenSettings)
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'WCAG 2.2 reference',
          click: () => void shell.openExternal('https://www.w3.org/WAI/WCAG22/quickref/')
        },
        {
          label: 'About',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            const opts = {
              type: 'info' as const,
              title: 'About',
              message: 'WCAG 2.2 Auditor',
              detail: `Version ${app.getVersion()}`
            };
            void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
