// Десктоп-приложение «Доска»: запускает сервер доски прямо на этом компьютере
// и открывает её в собственном окне. Доски хранятся в папке пользователя.
'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// в собранном приложении файлы доски лежат в desktop/app, при разработке — уровнем выше
const appRoot = fs.existsSync(path.join(__dirname, 'app', 'server.js')) ? path.join(__dirname, 'app') : path.join(__dirname, '..');

let win = null;
let srv = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 420,
    minHeight: 480,
    title: 'Доска',
    backgroundColor: '#f7f5ef',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL(srv.url + '/');
  // ссылки из чата и т. п. открываются в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(srv.url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => (win = null));
}

function buildMenu(dataDir) {
  const go = (p) => win && win.loadURL(srv.url + p);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Доска',
        submenu: [
          { label: 'Все доски', accelerator: 'CmdOrCtrl+Shift+H', click: () => go('/') },
          { label: 'Открыть в браузере', click: () => shell.openExternal(win ? win.webContents.getURL() : srv.url) },
          { label: 'Папка с досками', click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          { label: 'Выход', role: 'quit' },
        ],
      },
      {
        label: 'Вид',
        submenu: [
          { label: 'Обновить', role: 'reload' },
          { label: 'Во весь экран', role: 'togglefullscreen' },
          { type: 'separator' },
          { label: 'Инструменты разработчика', role: 'toggleDevTools' },
        ],
      },
    ])
  );
}

async function boot() {
  const { start } = require(path.join(appRoot, 'server.js'));
  const dataDir = path.join(app.getPath('userData'), 'boards');
  srv = await start({ port: 3210, fallbackPort: true, dataDir, desktop: true });
  buildMenu(dataDir);
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() =>
    boot().catch((e) => {
      dialog.showErrorBox('Доска не запустилась', String((e && e.message) || e));
      app.quit();
    })
  );
  app.on('activate', () => {
    if (!win && srv) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (srv) srv.close(); // сохраняет доски и закрывает доступ из интернета
  });
}
