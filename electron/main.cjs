const { app, BrowserWindow, ipcMain, desktopCapturer, session, systemPreferences, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Vom Renderer gewählte Quelle für den nächsten getDisplayMedia()-Aufruf
let pendingPick = null;

// Native Tonaufnahme (nur Windows, nur wenn mitgebaut): Ton einzelner Apps bzw. alles außer Hyco
let appAudio = null;
try {
  appAudio = require(path.join(__dirname, '..', 'native', 'hyco-audio'));
  if (!appAudio.available()) appAudio = null;
} catch {
  appAudio = null;
}
let win = null;
let tray = null;
let quitting = false;

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn
if (!app.requestSingleInstanceLock()) app.quit();
const show = () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};
const findInvite = (argv) => argv.find((a) => /^hyco:\/\/invite\//i.test(a)) || null;
let pendingInvite = findInvite(process.argv);
app.on('second-instance', (_e, argv) => {
  show();
  const link = findInvite(argv);
  if (link && win) win.webContents.send('invite:open', link);
});
app.setAsDefaultProtocolClient('hyco'); // hyco://-Links öffnen die App
app.setAppUserModelId('app.hyco.desktop'); // nötig für Windows-Benachrichtigungen

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0d1017',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Externe Links im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Schließen minimiert in den Infobereich (wie Discord); Beenden über das Tray-Menü
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('focus', () => win.flashFrame(false));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  // Liste der Bildschirme/Fenster für den eigenen Picker im Renderer
  ipcMain.handle('desktop:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });

  ipcMain.handle('desktop:pick', (_e, pick) => {
    pendingPick = pick; // { id, audio }
  });

  // getDisplayMedia() im Renderer landet hier. 'loopback' = System-Audio (Windows).
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === (pendingPick && pendingPick.id)) || sources[0];
      const withAudio = pendingPick && pendingPick.audio && request.audioRequested;
      pendingPick = null;
      callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
    } catch (err) {
      console.error(err);
      callback({});
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('appaudio:available', () => Boolean(appAudio));
  ipcMain.handle('appaudio:apps', () => (appAudio ? appAudio.listAudioApps().filter((a) => !/^hyco\.exe$/i.test(a.name)) : []));
  // mode 'exclude': alles außer Hyco; mode 'include': nur die Anwendung (pid oder Fenster-ID aus desktopCapturer)
  ipcMain.handle('appaudio:start', (event, { mode, pid, windowId }) => {
    if (!appAudio) throw new Error('App-Ton ist auf diesem System nicht verfügbar.');
    appAudio.stop();
    let target = process.pid;
    let include = false;
    if (mode === 'include') {
      include = true;
      target = pid || (windowId ? appAudio.pidForWindow(Number(windowId)) : 0);
      if (!target) throw new Error('Anwendung für den Ton nicht gefunden.');
    }
    const wc = event.sender;
    appAudio.start(target, include, (buf) => {
      if (!wc.isDestroyed()) wc.send('appaudio:data', buf);
    });
    return true;
  });
  ipcMain.handle('appaudio:stop', () => { appAudio?.stop(); });
  ipcMain.handle('invite:pending', () => {
    const link = pendingInvite;
    pendingInvite = null;
    return link;
  });

  // Update: Teile herunterladen, zusammensetzen, Prüfsumme vergleichen, Installer still starten
  ipcMain.handle('update:install', async (event, { urls, sha256, version }) => {
    if (process.platform !== 'win32') throw new Error('Automatische Updates gibt es nur unter Windows.');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Ungültige Versionsnummer.');
    for (const u of urls) {
      const { protocol, hostname } = new URL(u);
      if (protocol !== 'https:' || !hostname.endsWith('.supabase.co')) throw new Error('Unerlaubte Update-Quelle.');
    }
    const file = path.join(app.getPath('temp'), `Hyco-Setup-${version}.exe`);
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    let done = 0;
    for (const u of urls) {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}).`);
      const buf = Buffer.from(await res.arrayBuffer());
      hash.update(buf);
      await new Promise((resolve, reject) => out.write(buf, (err) => (err ? reject(err) : resolve())));
      done += 1;
      event.sender.send('update:progress', Math.round((done / urls.length) * 99));
    }
    await new Promise((resolve) => out.end(resolve));
    if (hash.digest('hex') !== sha256) {
      fs.rmSync(file, { force: true });
      throw new Error('Prüfsumme stimmt nicht – Update abgebrochen.');
    }
    event.sender.send('update:progress', 100);
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 800);
    return true;
  });

  ipcMain.on('desktop:attention', () => {
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  createWindow();
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip('Hyco');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Hyco öffnen', click: show },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', show);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  appAudio?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
