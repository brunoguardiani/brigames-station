import { app, BrowserWindow, clipboard, ipcMain, nativeImage, safeStorage } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

const backendURL = process.env['DESKTOP_BACKEND_URL'] ?? 'http://127.0.0.1:8080';
const backendHealthURL = backendURL + '/health';
if (process.platform === 'win32') app.setAppUserModelId('com.brigames-station.desktop');
let accessToken: string | undefined;
let realtimeSocket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelayMilliseconds = 1_000;

function desktopAssetPath(filename: string): string {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'assets', filename),
    path.resolve(__dirname, '..', 'src', 'assets', filename),
  ];

  return candidates.find(existsSync) ?? candidates[0];
}

function appIconPath(): string {
  return desktopAssetPath('brigames-station-icon.png');
}

function splashMascotPath(): string {
  return desktopAssetPath('brigames-station-mascot.png');
}

function isTrustedRendererURL(url: string): boolean {
  if (url.startsWith('file:')) return true;
  const rendererURL = process.env['ELECTRON_RENDERER_URL'];
  return rendererURL !== undefined && url.startsWith(rendererURL);
}

type User = { username: string; email: string; role: string };
type Tokens = { access_token: string; refresh_token: string };
type Server = { id: number; name: string; description: string; created_by: number; membership_role: 'owner' | 'member'; created_at: string };
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; online: boolean };
type Channel = { id: number; server_id: number; name: string; type: 'text' | 'voice'; position: number; created_by: number; created_at: string };
type Message = { id: number; channel_id: number; author_id: number; author_username: string; content: string; created_at: string };
type MessagePage = { messages: Message[]; next_before: number | null };

function realtimeURL(): string {
  return backendURL.replace(/^http/, 'ws') + '/ws';
}
function sendToRenderers(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}
function disconnectRealtime(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectDelayMilliseconds = 1_000;
  const socket = realtimeSocket;
  realtimeSocket = undefined;
  socket?.close();
}
function scheduleRealtimeReconnect(): void {
  if (!accessToken || reconnectTimer) return;
  const delay = reconnectDelayMilliseconds;
  reconnectDelayMilliseconds = Math.min(reconnectDelayMilliseconds * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectRealtime();
  }, delay);
}
function connectRealtime(): void {
  if (!accessToken || realtimeSocket) return;
  const socket = new WebSocket(realtimeURL());
  realtimeSocket = socket;
  socket.addEventListener('open', () => {
    if (realtimeSocket === socket && accessToken) socket.send(JSON.stringify({ type: 'authenticate', access_token: accessToken }));
  });
  socket.addEventListener('message', (event) => {
    if (realtimeSocket !== socket || typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as { type?: string; data?: Message };
      if (message.type === 'authenticated') {
        reconnectDelayMilliseconds = 1_000;
        sendToRenderers('realtime:connected');
      } else if (message.type === 'message.created' && message.data) {
        sendToRenderers('realtime:message-created', message.data);
      } else if (message.type === 'presence.changed' && message.data) {
        sendToRenderers('realtime:presence-changed', message.data);
      }
    } catch { /* Ignore invalid realtime payloads. */ }
  });
  socket.addEventListener('error', () => socket.close());
  socket.addEventListener('close', () => {
    if (realtimeSocket === socket) {
      realtimeSocket = undefined;
      scheduleRealtimeReconnect();
    }
  });
}

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
	connectRealtime();
	return await userResponse.json() as User;
}
async function authenticatedRequest<T>(pathname: string, method = 'GET', body?: Record<string, string>): Promise<T> {
  if (!accessToken) throw new Error('No active session.');
  const response = await fetch(backendURL + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? 'Backend request failed.');
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function isBackendHealth(value: unknown): value is { status: 'alive' } {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'alive';
}

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 360,
    height: 340,
    show: false,
    frame: false,
    resizable: false,
    transparent: false,
    alwaysOnTop: true,
    backgroundColor: '#14161d',
    icon: appIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const mascotURL = nativeImage.createFromPath(splashMascotPath()).toDataURL();
  const markup = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#14161d;color:#f3f4f8;font-family:system-ui,sans-serif}main{text-align:center}img{width:180px;height:180px;object-fit:contain;animation:pulse 1.5s ease-in-out infinite}@keyframes pulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 #766cf666)}50%{transform:scale(1.06);filter:drop-shadow(0 0 18px #766cf99)}}p{margin:22px 0 0;color:#a3abbc;font-size:14px}</style></head><body><main><img src="${mascotURL}" alt="Mascote brigames-station"><p>Carregando os baits...</p></main></body></html>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup)}`);
  splash.once('ready-to-show', () => splash.show());
  return splash;
}

async function createWindow(onReady: (window: BrowserWindow) => void): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    backgroundColor: '#14161d',
    icon: appIconPath(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#14161d',
      symbolColor: '#f3f4f8',
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isTrustedRendererURL(webContents.getURL()));
  });
  window.once('ready-to-show', () => onReady(window));

  const rendererURL = process.env['ELECTRON_RENDERER_URL'];
  if (rendererURL) {
    await window.loadURL(rendererURL);
    return window;
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'desktop', 'browser', 'index.html'));
  return window;
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
  try { return await authenticate('/auth/refresh', { refresh_token: refreshToken }); } catch { disconnectRealtime(); accessToken = undefined; await fs.rm(refreshTokenPath(), { force: true }); return null; }
});
ipcMain.handle('auth:logout', async (): Promise<void> => {
  const refreshToken = await loadRefreshToken();
  if (refreshToken) await fetch(backendURL + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => undefined);
  disconnectRealtime();
  accessToken = undefined;
  await fs.rm(refreshTokenPath(), { force: true });
});
ipcMain.handle('servers:list', (): Promise<Server[]> => authenticatedRequest<Server[]>('/servers'));
ipcMain.handle('servers:list-members', (_event, serverID: unknown): Promise<ServerMember[]> => {
  if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0) throw new Error('Invalid server ID.');
  return authenticatedRequest<ServerMember[]>('/servers/' + serverID + '/members');
});
ipcMain.handle('servers:create', (_event, name: unknown, description: unknown): Promise<Server> => {
  if (typeof name !== 'string' || typeof description !== 'string') throw new Error('Invalid server input.');
  return authenticatedRequest<Server>('/servers', 'POST', { name, description });
});
ipcMain.handle('channels:list', (_event, serverID: unknown): Promise<Channel[]> => {
  if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0) throw new Error('Invalid server ID.');
  return authenticatedRequest<Channel[]>('/servers/' + serverID + '/channels');
});
ipcMain.handle('channels:create', (_event, serverID: unknown, name: unknown, type: unknown): Promise<Channel> => {
  if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0 || typeof name !== 'string' || (type !== 'text' && type !== 'voice')) throw new Error('Invalid channel input.');
  return authenticatedRequest<Channel>('/servers/' + serverID + '/channels', 'POST', { name, type });
});
ipcMain.handle('servers:leave', (_event, serverID: unknown): Promise<void> => {
  if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0) throw new Error('Invalid server ID.');
  return authenticatedRequest<void>('/servers/' + serverID + '/leave', 'POST');
});
ipcMain.handle('messages:list', (_event, channelID: unknown): Promise<MessagePage> => { if (typeof channelID !== 'number' || !Number.isSafeInteger(channelID) || channelID <= 0) throw new Error('Invalid channel ID.'); return authenticatedRequest<MessagePage>('/channels/' + channelID + '/messages'); });
ipcMain.handle('messages:create', (_event, channelID: unknown, content: unknown): Promise<Message> => { if (typeof channelID !== 'number' || !Number.isSafeInteger(channelID) || channelID <= 0 || typeof content !== 'string') throw new Error('Invalid message input.'); return authenticatedRequest<Message>('/channels/' + channelID + '/messages', 'POST', { content }); });
ipcMain.handle('voice:join', (_event, channelID: unknown): Promise<{ url: string; token: string; room: string }> => { if (typeof channelID !== 'number' || !Number.isSafeInteger(channelID) || channelID <= 0) throw new Error('Invalid voice channel ID.'); return authenticatedRequest('/voice/channels/' + channelID + '/token', 'POST'); });
ipcMain.handle('invites:create', (_event, serverID: unknown): Promise<{ code: string; expires_at: string }> => { if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0) throw new Error('Invalid server ID.'); return authenticatedRequest('/servers/' + serverID + '/invites', 'POST'); });
ipcMain.handle('invites:create-and-copy', async (_event, serverID: unknown): Promise<{ code: string; expires_at: string }> => {
  if (typeof serverID !== 'number' || !Number.isSafeInteger(serverID) || serverID <= 0) throw new Error('Invalid server ID.');
  const invite = await authenticatedRequest<{ code: string; expires_at: string }>('/servers/' + serverID + '/invites', 'POST');
  clipboard.writeText(invite.code);
  return invite;
});
ipcMain.handle('invites:join', (_event, code: unknown): Promise<{ server_id: number }> => { if (typeof code !== 'string' || !code) throw new Error('Invalid invite code.'); return authenticatedRequest('/invites/' + encodeURIComponent(code) + '/join', 'POST'); });

app
  .whenReady()
  .then(async () => {
    const splash = createSplashWindow();
    const splashStartedAt = Date.now();
    await createWindow((window) => {
      const remainingSplashMilliseconds = Math.max(0, 3_000 - (Date.now() - splashStartedAt));
      setTimeout(() => {
        window.show();
        if (!splash.isDestroyed()) splash.close();
      }, remainingSplashMilliseconds);
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow((window) => window.show());
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
