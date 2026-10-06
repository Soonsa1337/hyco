const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getSources: () => ipcRenderer.invoke('desktop:sources'),
  pick: (pick) => ipcRenderer.invoke('desktop:pick', pick),
  attention: () => ipcRenderer.send('desktop:attention'),
  version: () => ipcRenderer.invoke('app:version'),
  // App-genauer Ton (native Komponente, Windows)
  appAudio: {
    available: () => ipcRenderer.invoke('appaudio:available'),
    apps: () => ipcRenderer.invoke('appaudio:apps'),
    start: (opts) => ipcRenderer.invoke('appaudio:start', opts),
    stop: () => ipcRenderer.invoke('appaudio:stop'),
    onData: (fn) => {
      const h = (_e, buf) => fn(buf);
      ipcRenderer.on('appaudio:data', h);
      return () => ipcRenderer.removeListener('appaudio:data', h);
    },
  },
  // Einladungslinks (hyco://invite/CODE), die Windows an die App übergibt
  pendingInvite: () => ipcRenderer.invoke('invite:pending'),
  onInvite: (fn) => {
    const h = (_e, link) => fn(link);
    ipcRenderer.on('invite:open', h);
    return () => ipcRenderer.removeListener('invite:open', h);
  },
  installUpdate: (update) => ipcRenderer.invoke('update:install', update),
  onUpdateProgress: (fn) => {
    const h = (_e, pct) => fn(pct);
    ipcRenderer.on('update:progress', h);
    return () => ipcRenderer.removeListener('update:progress', h);
  },
});
