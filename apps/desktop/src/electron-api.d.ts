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
