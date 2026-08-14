import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  backend: {
    getHealth: (): Promise<{ status: 'alive' }> => ipcRenderer.invoke('backend:get-health'),
  },
  auth: {
    login: (identity: string, password: string) => ipcRenderer.invoke('auth:login', identity, password),
    currentSession: () => ipcRenderer.invoke('auth:current-session'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    create: (name: string, description: string) => ipcRenderer.invoke('servers:create', name, description),
    leave: (serverID: number) => ipcRenderer.invoke('servers:leave', serverID),
  },
  channels: {
    list: (serverID: number) => ipcRenderer.invoke('channels:list', serverID),
    create: (serverID: number, name: string) => ipcRenderer.invoke('channels:create', serverID, name),
  },
});
