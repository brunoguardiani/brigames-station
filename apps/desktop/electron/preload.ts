import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  backend: {
    getHealth: (): Promise<{ status: 'alive' }> => ipcRenderer.invoke('backend:get-health'),
  },
  auth: {
    login: (identity: string, password: string) => ipcRenderer.invoke('auth:login', identity, password),
    register: (username: string, email: string, password: string) => ipcRenderer.invoke('auth:register', username, email, password),
    currentSession: () => ipcRenderer.invoke('auth:current-session'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    listMembers: (serverID: number) => ipcRenderer.invoke('servers:list-members', serverID),
    create: (name: string, description: string) => ipcRenderer.invoke('servers:create', name, description),
    leave: (serverID: number) => ipcRenderer.invoke('servers:leave', serverID),
  },
  channels: {
    list: (serverID: number) => ipcRenderer.invoke('channels:list', serverID),
    create: (serverID: number, name: string, type: 'text' | 'voice') => ipcRenderer.invoke('channels:create', serverID, name, type),
  },
  messages: { list: (channelID: number) => ipcRenderer.invoke('messages:list', channelID), create: (channelID: number, content: string) => ipcRenderer.invoke('messages:create', channelID, content) },
  voice: {
    join: (channelID: number) => ipcRenderer.invoke('voice:join', channelID),
    setPresence: (channelID: number | null) => ipcRenderer.invoke('voice:set-presence', channelID),
  },
  screenShare: {
    listSources: () => ipcRenderer.invoke('screen-share:list-sources'),
    selectSource: (sourceID: string) => ipcRenderer.invoke('screen-share:select-source', sourceID),
  },
  invites: { create: (serverID: number) => ipcRenderer.invoke('invites:create', serverID), createAndCopy: (serverID: number) => ipcRenderer.invoke('invites:create-and-copy', serverID), join: (code: string) => ipcRenderer.invoke('invites:join', code) },
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
    onPresenceChanged: (callback: (presence: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, presence: unknown) => callback(presence);
      ipcRenderer.on('realtime:presence-changed', listener);
      return () => ipcRenderer.removeListener('realtime:presence-changed', listener);
    },
    onVoicePresenceChanged: (callback: (presence: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, presence: unknown) => callback(presence);
      ipcRenderer.on('realtime:voice-presence-changed', listener);
      return () => ipcRenderer.removeListener('realtime:voice-presence-changed', listener);
    },
  },
});
