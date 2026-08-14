import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const backendURL = process.env['DESKTOP_BACKEND_URL'] ?? 'http://127.0.0.1:8080';
const backendHealthURL = backendURL + '/health';
let accessToken: string | undefined;

type User = { username: string; email: string; role: string };
type Tokens = { access_token: string; refresh_token: string };

function refreshTokenPath(): string { return path.join(app.getPath('userData'), 'refresh-token.bin'); }
async function saveRefreshToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure operating-system storage is unavailable.');
  await fs.writeFile(refreshTokenPath(), safeStorage.encryptString(token));
}
async function loadRefreshToken(): Promise<string | null> {
  try { return safeStorage.decryptString(await fs.readFile(refreshTokenPath())); } catch { return null; }
}
async function authenticate(pathname: string, body: Record<string, string>): Promise<User> {
  const response = await fetch(backendURL + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Authentication failed.');
  const tokens = await response.json() as Tokens;
  const userResponse = await fetch(backendURL + '/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  if (!userResponse.ok) throw new Error('Session is invalid.');
  accessToken = tokens.access_token;
  await saveRefreshToken(tokens.refresh_token);
  return await userResponse.json() as User;
}

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

ipcMain.handle('auth:login', async (_event, identity: unknown, password: unknown): Promise<User> => {
  if (typeof identity !== 'string' || typeof password !== 'string') throw new Error('Invalid login input.');
  return authenticate('/auth/login', { identity, password });
});
ipcMain.handle('auth:current-session', async (): Promise<User | null> => {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) return null;
  try { return await authenticate('/auth/refresh', { refresh_token: refreshToken }); } catch { accessToken = undefined; await fs.rm(refreshTokenPath(), { force: true }); return null; }
});
ipcMain.handle('auth:logout', async (): Promise<void> => {
  const refreshToken = await loadRefreshToken();
  if (refreshToken) await fetch(backendURL + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => undefined);
  accessToken = undefined;
  await fs.rm(refreshTokenPath(), { force: true });
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
