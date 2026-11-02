const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  login: () => ipcRenderer.invoke('login'),
  cancelLogin: () => ipcRenderer.invoke('cancelLogin'),
  loginOfficial: () => ipcRenderer.invoke('loginOfficial'),
  loginOffline: (name) => ipcRenderer.invoke('loginOffline', name),
  logout: () => ipcRenderer.invoke('logout'),
  play: () => ipcRenderer.invoke('play'),
  killGame: () => ipcRenderer.invoke('killGame'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (s) => ipcRenderer.invoke('setSettings', s),
  openGameDir: () => ipcRenderer.invoke('openGameDir'),
  openExternal: (u) => ipcRenderer.invoke('openExternal', u),
  installLauncherUpdate: () => ipcRenderer.invoke('installLauncherUpdate'),
  on: (ch, fn) => ipcRenderer.on(ch, (e, data) => fn(data)),
});
