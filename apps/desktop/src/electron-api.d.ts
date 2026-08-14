interface BackendHealth {
  status: 'alive';
}

interface Window {
  desktop: {
    backend: {
      getHealth(): Promise<BackendHealth>;
    };
  };
}
