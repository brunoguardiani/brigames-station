import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

const backendHealthURL = 'http://127.0.0.1:8080/health';

function isBackendHealth(value: unknown): value is { status: 'alive' } {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'alive';
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const rendererURL = process.env['ELECTRON_RENDERER_URL'];
  if (rendererURL) {
    await window.loadURL(rendererURL);
    return;
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'desktop', 'browser', 'index.html'));
}

ipcMain.handle('backend:get-health', async (): Promise<{ status: 'alive' }> => {
  const response = await fetch(`${backendHealthURL}?timestamp=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Backend health check failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!isBackendHealth(body)) {
    throw new Error('Backend health response has an invalid shape');
  }

  return body;
});

app
  .whenReady()
  .then(async () => {
    await createWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('Electron startup failed', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
