interface BackendHealth {
  status: 'alive';
}

interface Window {
  desktop: {
    backend: {
      getHealth(): Promise<BackendHealth>;
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
      setPresence(channelID: number | null): Promise<void>;
    };
    screenShare: {
      listSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>;
      selectSource(sourceID: string): Promise<void>;
    };
    invites: { create(serverID: number): Promise<{ code: string; expires_at: string }>; createAndCopy(serverID: number): Promise<{ code: string; expires_at: string }>; join(code: string): Promise<{ server_id: number }>; };
    realtime: {
      onConnected(callback: () => void): () => void;
      onMessageCreated(callback: (message: Message) => void): () => void;
      onPresenceChanged(callback: (presence: { user_id: number; online: boolean }) => void): () => void;
      onVoicePresenceChanged(callback: (presence: { server_id: number; user_id: number; channel_id: number | null }) => void): () => void;
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
