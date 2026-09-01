import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopUpdaterStatus } from './updater/updater.types';

contextBridge.exposeInMainWorld('desktop', {
  app: {
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  },
  backend: {
    getHealth: (): Promise<{ status: 'alive' }> => ipcRenderer.invoke('backend:get-health'),
  },
  updater: {
    getStatus: (): Promise<DesktopUpdaterStatus> => ipcRenderer.invoke('updater:get-status'),
    checkForUpdates: (): Promise<DesktopUpdaterStatus> => ipcRenderer.invoke('updater:check-for-updates'),
    installUpdate: (): Promise<boolean> => ipcRenderer.invoke('updater:install-update'),
    onStatusChange: (callback: (status: DesktopUpdaterStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: DesktopUpdaterStatus) => callback(status);
      ipcRenderer.on('updater:status-changed', listener);
      return () => ipcRenderer.removeListener('updater:status-changed', listener);
    },
  },
  auth: {
    login: (identity: string, password: string) => ipcRenderer.invoke('auth:login', identity, password),
    register: (username: string, email: string, password: string) => ipcRenderer.invoke('auth:register', username, email, password),
    currentSession: () => ipcRenderer.invoke('auth:current-session'),
    updateAvatar: (avatarID: string | null) => ipcRenderer.invoke('auth:update-avatar', avatarID),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onSessionExpired: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('auth:session-expired', listener);
      return () => ipcRenderer.removeListener('auth:session-expired', listener);
    },
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
    getWebRTCConfiguration: () => ipcRenderer.invoke('voice:get-webrtc-configuration'),
    setPresence: (channelID: number | null) => ipcRenderer.invoke('voice:set-presence', channelID),
  },
  screenShare: {
    listSources: () => ipcRenderer.invoke('screen-share:list-sources'),
    selectSource: (sourceID: string) => ipcRenderer.invoke('screen-share:select-source', sourceID),
  },
  invites: { create: (serverID: number) => ipcRenderer.invoke('invites:create', serverID), createAndCopy: (serverID: number) => ipcRenderer.invoke('invites:create-and-copy', serverID), join: (code: string) => ipcRenderer.invoke('invites:join', code) },
  settings: {
    get: (): Promise<{ hardwareAcceleration: boolean; active: boolean; appVersion: string; noiseFilter: boolean; inputVolumeDb: number; inputDeviceId: string | null; outputDeviceId: string | null; outputVolume: number; participantAudioPreferences: Record<string, { volume: number; muted: boolean }> }> => ipcRenderer.invoke('settings:get'),
    setHardwareAcceleration: (enabled: boolean): Promise<{ restartRequired: boolean }> => ipcRenderer.invoke('settings:set-hardware-acceleration', enabled),
    setNoiseFilter: (enabled: boolean): Promise<void> => ipcRenderer.invoke('settings:set-noise-filter', enabled),
    setAudio: (patch: { inputVolumeDb?: number; inputDeviceId?: string | null; outputDeviceId?: string | null; outputVolume?: number }): Promise<void> => ipcRenderer.invoke('settings:set-audio', patch),
    setParticipantAudio: (userID: string, preference: { volume: number; muted: boolean } | null): Promise<void> => ipcRenderer.invoke('settings:set-participant-audio', userID, preference),
  },
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
    onProfileUpdated: (callback: (profile: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profile: unknown) => callback(profile);
      ipcRenderer.on('realtime:profile-updated', listener);
      return () => ipcRenderer.removeListener('realtime:profile-updated', listener);
    },
    sendWebRTCSignal: (signal: unknown) => ipcRenderer.invoke('realtime:send-webrtc-signal', signal),
    onWebRTCSignal: (callback: (signal: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, signal: unknown) => callback(signal);
      ipcRenderer.on('realtime:webrtc-signal', listener);
      return () => ipcRenderer.removeListener('realtime:webrtc-signal', listener);
    },
  },
});
