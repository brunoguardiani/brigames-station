import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  backend: {
    getHealth: (): Promise<{ status: 'alive' }> => ipcRenderer.invoke('backend:get-health'),
  },
});
