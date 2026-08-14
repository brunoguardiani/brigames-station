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
});
