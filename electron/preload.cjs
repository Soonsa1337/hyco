const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getSources: () => ipcRenderer.invoke('desktop:sources'),
  pick: (pick) => ipcRenderer.invoke('desktop:pick', pick),
  attention: () => ipcRenderer.send('desktop:attention'),
  version: () => ipcRenderer.invoke('app:version'),
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
