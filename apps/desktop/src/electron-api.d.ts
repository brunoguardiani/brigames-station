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
  };
}
