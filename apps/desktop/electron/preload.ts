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
  messages: { list: (channelID: number) => ipcRenderer.invoke('messages:list', channelID), create: (channelID: number, content: string) => ipcRenderer.invoke('messages:create', channelID, content) },
  invites: { create: (serverID: number) => ipcRenderer.invoke('invites:create', serverID), join: (code: string) => ipcRenderer.invoke('invites:join', code) },
  realtime: {
    onConnected: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('realtime:connected', listener);
      return () => ipcRenderer.removeListener('realtime:connected', listener);
    },
    onMessageCreated: (callback: (message: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message);
      ipcRenderer.on('realtime:message-created', listener);
      return () => ipcRenderer.removeListener('realtime:message-created', listener);
    },
  },
});
