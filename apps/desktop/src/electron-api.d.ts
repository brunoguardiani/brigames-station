interface BackendHealth {
  status: 'alive';
}

type DesktopUpdaterStatus = import('../electron/updater/updater.types').DesktopUpdaterStatus;

interface Window {
  desktop: {
    app: {
      relaunch(): Promise<void>;
    };
    backend: {
      getHealth(): Promise<BackendHealth>;
    };
    updater: {
      getStatus(): Promise<DesktopUpdaterStatus>;
      checkForUpdates(): Promise<DesktopUpdaterStatus>;
      installUpdate(): Promise<boolean>;
      onStatusChange(callback: (status: DesktopUpdaterStatus) => void): () => void;
    };
    auth: {
      login(identity: string, password: string): Promise<{ username: string; email: string; role: string }>;
      register(username: string, email: string, password: string): Promise<{ username: string; email: string; role: string }>;
      currentSession(): Promise<{ username: string; email: string; role: string } | null>;
      logout(): Promise<void>;
      onSessionExpired(callback: () => void): () => void;
    };
    servers: {
      list(): Promise<Server[]>;
      listMembers(serverID: number): Promise<ServerMember[]>;
      create(name: string, description: string): Promise<Server>;
      leave(serverID: number): Promise<void>;
    };
    channels: {
      list(serverID: number): Promise<Channel[]>;
      create(serverID: number, name: string, type: 'text' | 'voice'): Promise<Channel>;
    };
    messages: { list(channelID: number): Promise<MessagePage>; create(channelID: number, content: string): Promise<Message>; };
    voice: {
      join(channelID: number): Promise<{ url: string; token: string; room: string }>;
      getWebRTCConfiguration(): Promise<{ iceServers: Array<{ urls: string }> }>;
      setPresence(channelID: number | null): Promise<void>;
    };
    screenShare: {
      listSources(): Promise<Array<{ id: string; name: string; thumbnail: string; icon?: string; kind: 'screen' | 'window'; category: 'window' | 'screen' | 'application' }>>;
      selectSource(sourceID: string): Promise<void>;
    };
    invites: { create(serverID: number): Promise<{ code: string; expires_at: string }>; createAndCopy(serverID: number): Promise<{ code: string; expires_at: string }>; join(code: string): Promise<{ server_id: number }>; };
    settings: {
      get(): Promise<{ hardwareAcceleration: boolean; active: boolean; appVersion: string; noiseFilter: boolean; inputVolumeDb: number; inputDeviceId: string | null; outputDeviceId: string | null; outputVolume: number }>;
      setHardwareAcceleration(enabled: boolean): Promise<{ restartRequired: boolean }>;
      setNoiseFilter(enabled: boolean): Promise<void>;
      setAudio(patch: { inputVolumeDb?: number; inputDeviceId?: string | null; outputDeviceId?: string | null; outputVolume?: number }): Promise<void>;
    };
    realtime: {
      onConnected(callback: () => void): () => void;
      onMessageCreated(callback: (message: Message) => void): () => void;
      onPresenceChanged(callback: (presence: { user_id: number; online: boolean }) => void): () => void;
      onVoicePresenceChanged(callback: (presence: { server_id: number; user_id: number; channel_id: number | null }) => void): () => void;
      sendWebRTCSignal(signal: { channel_id: number; to_user_id: number; kind: 'offer' | 'answer' | 'ice' | 'media.available' | 'media.unavailable' | 'media.query' | 'media.watch' | 'media.unwatch'; session_id?: string; payload: unknown }): Promise<void>;
      onWebRTCSignal(callback: (signal: { channel_id: number; from_user_id: number; kind: 'offer' | 'answer' | 'ice' | 'media.available' | 'media.unavailable' | 'media.query' | 'media.watch' | 'media.unwatch'; session_id?: string; payload: unknown }) => void): () => void;
    };
  };
}

interface Server {
  id: number;
  name: string;
  description: string;
  created_by: number;
  membership_role: 'owner' | 'member';
  created_at: string;
}

interface Channel {
  id: number;
  server_id: number;
  name: string;
  type: 'text' | 'voice';
  position: number;
  created_by: number;
  created_at: string;
}
interface Message { id: number; channel_id: number; author_id: number; author_username: string; content: string; created_at: string; }
interface MessagePage { messages: Message[]; next_before: number | null; }
interface ServerMember { id: number; username: string; role: 'owner' | 'member'; online: boolean; voice_channel_id: number | null; }
