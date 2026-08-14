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
      currentSession(): Promise<{ username: string; email: string; role: string } | null>;
      logout(): Promise<void>;
    };
    servers: {
      list(): Promise<Server[]>;
      create(name: string, description: string): Promise<Server>;
      leave(serverID: number): Promise<void>;
    };
    channels: {
      list(serverID: number): Promise<Channel[]>;
      create(serverID: number, name: string): Promise<Channel>;
    };
    messages: { list(channelID: number): Promise<MessagePage>; create(channelID: number, content: string): Promise<Message>; };
    invites: { create(serverID: number): Promise<{ code: string; expires_at: string }>; join(code: string): Promise<{ server_id: number }>; };
    realtime: {
      onConnected(callback: () => void): () => void;
      onMessageCreated(callback: (message: Message) => void): () => void;
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
  type: 'text';
  position: number;
  created_by: number;
  created_at: string;
}
interface Message { id: number; channel_id: number; author_id: number; content: string; created_at: string; }
interface MessagePage { messages: Message[]; next_before: number | null; }
