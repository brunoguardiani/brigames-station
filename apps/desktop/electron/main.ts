import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, nativeImage, safeStorage } from 'electron';
import { existsSync, promises as fs, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ElectronAutoUpdaterAdapter } from './updater/electron-updater-adapter';
import { registerDesktopUpdaterIPC } from './updater/updater.ipc';
import { DesktopUpdaterService } from './updater/updater.service';
import { DESKTOP_UPDATER_CHANNELS } from './updater/updater.types';

const backendURL = process.env['DESKTOP_BACKEND_URL'] ?? (app.isPackaged ? 'https://api.groupgo.com.br' : 'http://127.0.0.1:8080');
const backendHealthURL = backendURL + '/health';
const webRTCStunURL = process.env['WEBRTC_STUN_URL'] ?? 'stun:stun.cloudflare.com:3478';
const debugEnabled = process.argv.includes('--debug') || process.env['BRIGAMES_DEBUG'] === '1';

type ParticipantAudioPreference = { volume: number; muted: boolean };
type AppSettings = { hardwareAcceleration: boolean; noiseFilter: boolean; inputVolumeDb: number; inputDeviceId: string | null; outputDeviceId: string | null; outputVolume: number; participantAudioPreferences: Record<string, ParticipantAudioPreference> };
function desktopAppVersion(): string {
  try {
    const version = (JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version?: string }).version;
    if (typeof version === 'string' && version) return version;
  } catch { /* Fall back to Electron's own version below. */ }
  return app.getVersion();
}
function settingsPath(): string { return path.join(app.getPath('userData'), 'settings.json'); }
function participantAudioPreferences(value: unknown): Record<string, ParticipantAudioPreference> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preferences: Record<string, ParticipantAudioPreference> = {};
  for (const [userID, candidate] of Object.entries(value).slice(0, 1_000)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userID) || !candidate || typeof candidate !== 'object') continue;
    const preference = candidate as Partial<ParticipantAudioPreference>;
    if (typeof preference.volume !== 'number' || !Number.isFinite(preference.volume) || typeof preference.muted !== 'boolean') continue;
    preferences[userID] = { volume: Math.min(1, Math.max(0, preference.volume)), muted: preference.muted };
  }
  return preferences;
}
function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>;
    return {
      hardwareAcceleration: raw.hardwareAcceleration !== false,
      noiseFilter: raw.noiseFilter !== false,
      inputVolumeDb: typeof raw.inputVolumeDb === 'number' && Number.isFinite(raw.inputVolumeDb) ? Math.min(30, Math.max(-30, raw.inputVolumeDb)) : 0,
      inputDeviceId: typeof raw.inputDeviceId === 'string' && raw.inputDeviceId ? raw.inputDeviceId : null,
      outputDeviceId: typeof raw.outputDeviceId === 'string' && raw.outputDeviceId ? raw.outputDeviceId : null,
      outputVolume: typeof raw.outputVolume === 'number' && Number.isFinite(raw.outputVolume) ? Math.min(2, Math.max(0, raw.outputVolume)) : 1,
      participantAudioPreferences: participantAudioPreferences(raw.participantAudioPreferences),
    };
  } catch {
    return { hardwareAcceleration: true, noiseFilter: true, inputVolumeDb: 0, inputDeviceId: null, outputDeviceId: null, outputVolume: 1, participantAudioPreferences: {} };
  }
}
function writeSettings(settings: AppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
const appSettings = readSettings();
const hardwareAccelerationActive = appSettings.hardwareAcceleration;
if (!appSettings.hardwareAcceleration) app.disableHardwareAcceleration();
if (process.platform === 'win32') app.setAppUserModelId('com.brigames-station.desktop');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}
let accessToken: string | undefined;
let accessTokenExpiresAt: number | undefined;
let realtimeSocket: WebSocket | undefined;
let realtimePingTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelayMilliseconds = 1_000;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<void> | undefined;
let realtimeRefreshRequired = false;
let selectedDisplaySourceID: string | undefined;
let primaryWindow: BrowserWindow | undefined;
let selectedDisplaySource: Electron.DesktopCapturerSource | undefined;
let cachedDisplaySources: Electron.DesktopCapturerSource[] = [];

function desktopAssetPath(filename: string): string {
  const candidates = [
    path.join(process.resourcesPath, 'assets', filename),
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
  const rendererURL = process.env['ELECTRON_RENDERER_URL'];
  if (rendererURL) {
    try {
      return new URL(url).origin === new URL(rendererURL).origin;
    } catch {
      return false;
    }
  }

  try {
    const actualPath = path.resolve(fileURLToPath(new URL(url)));
    const expectedPath = path.resolve(__dirname, '..', 'dist', 'desktop', 'browser', 'index.html');
    return process.platform === 'win32'
      ? actualPath.toLowerCase() === expectedPath.toLowerCase()
      : actualPath === expectedPath;
  } catch {
    return false;
  }
}

type User = { id: number; username: string; email: string; role: string; avatar_id: string | null };
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Server = { id: number; name: string; description: string; created_by: number; membership_role: 'owner' | 'member'; created_at: string };
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; avatar_id: string | null; online: boolean; voice_channel_id: number | null };
type Channel = { id: number; server_id: number; name: string; type: 'text' | 'voice'; position: number; created_by: number; created_at: string };
type Message = { id: number; channel_id: number; author_id: number; author_username: string; author_avatar_id: string | null; content: string; created_at: string };
type MessagePage = { messages: Message[]; next_before: number | null };
type DisplaySourceCategory = 'window' | 'screen' | 'application';
type DisplaySource = { id: string; name: string; thumbnail: string; icon?: string; kind: 'screen' | 'window'; category: DisplaySourceCategory };
type VoicePresenceChanged = { server_id: number; user_id: number; channel_id: number | null };
type ProfileUpdated = { user_id: number; avatar_id: string | null };
type WebRTCSignalKind = 'offer' | 'answer' | 'ice' | 'media.available' | 'media.unavailable' | 'media.query' | 'media.watch' | 'media.unwatch';
type WebRTCSignal = { channel_id: number; to_user_id: number; kind: WebRTCSignalKind; session_id?: string; payload: unknown };
type IncomingWebRTCSignal = Omit<WebRTCSignal, 'to_user_id'> & { from_user_id: number };

const negotiationSignalKinds: readonly WebRTCSignalKind[] = ['offer', 'answer', 'ice'];
const webRTCSessionIDPattern = /^[A-Za-z0-9_-]{1,64}$/;

function hasValidWebRTCSession(signal: { kind?: unknown; session_id?: unknown }): boolean {
  if (typeof signal.kind !== 'string') return false;
  return negotiationSignalKinds.includes(signal.kind as WebRTCSignalKind)
    ? typeof signal.session_id === 'string' && webRTCSessionIDPattern.test(signal.session_id)
    : signal.session_id === undefined || signal.session_id === '';
}

function isWebRTCSignal(value: unknown): value is WebRTCSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Partial<WebRTCSignal>;
  return Number.isSafeInteger(signal.channel_id) && (signal.channel_id ?? 0) > 0
    && Number.isSafeInteger(signal.to_user_id) && (signal.to_user_id ?? 0) > 0
    && typeof signal.kind === 'string'
    && ['offer', 'answer', 'ice', 'media.available', 'media.unavailable', 'media.query', 'media.watch', 'media.unwatch'].includes(signal.kind)
    && hasValidWebRTCSession(signal)
    && signal.payload !== undefined;
}

function isIncomingWebRTCSignal(value: unknown): value is IncomingWebRTCSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Partial<IncomingWebRTCSignal>;
  return Number.isSafeInteger(signal.channel_id) && (signal.channel_id ?? 0) > 0
    && Number.isSafeInteger(signal.from_user_id) && (signal.from_user_id ?? 0) > 0
    && typeof signal.kind === 'string'
    && ['offer', 'answer', 'ice', 'media.available', 'media.unavailable', 'media.query', 'media.watch', 'media.unwatch'].includes(signal.kind)
    && hasValidWebRTCSession(signal)
    && signal.payload !== undefined;
}

class SessionRefreshError extends Error {
  constructor(message: string, readonly terminal: boolean) { super(message); }
}

function realtimeURL(): string {
  return backendURL.replace(/^http/, 'ws') + '/ws';
}
function sendToRenderers(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}
function clearRefreshTimer(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = undefined;
}
function clearRealtimePing(): void {
  if (realtimePingTimer) clearInterval(realtimePingTimer);
  realtimePingTimer = undefined;
}
function disconnectRealtime(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectDelayMilliseconds = 1_000;
  realtimeRefreshRequired = false;
  clearRealtimePing();
  const socket = realtimeSocket;
  realtimeSocket = undefined;
  socket?.close();
}
async function invalidateSession(): Promise<void> {
  const hadActiveSession = accessToken !== undefined || accessTokenExpiresAt !== undefined;
  accessToken = undefined;
  accessTokenExpiresAt = undefined;
  clearRefreshTimer();
  disconnectRealtime();
  await fs.rm(refreshTokenPath(), { force: true });
  if (hadActiveSession) sendToRenderers('auth:session-expired');
}
function scheduleTokenRefresh(): void {
  clearRefreshTimer();
  if (!accessTokenExpiresAt) return;
  const delay = Math.max(1_000, accessTokenExpiresAt - Date.now() - 60_000);
  refreshTimer = setTimeout(() => {
    void refreshAccessToken().catch((error) => {
      if (error instanceof SessionRefreshError && error.terminal) {
        void invalidateSession();
        return;
      }
      scheduleTokenRefreshRetry();
    });
  }, delay);
}
function scheduleTokenRefreshRetry(): void {
  clearRefreshTimer();
  if (!accessToken) return;
  refreshTimer = setTimeout(() => {
    void refreshAccessToken().catch((error) => {
      if (error instanceof SessionRefreshError && error.terminal) void invalidateSession();
      else scheduleTokenRefreshRetry();
    });
  }, 30_000);
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
async function connectRealtime(): Promise<void> {
  if (!accessToken || realtimeSocket) return;
  if (realtimeRefreshRequired || (accessTokenExpiresAt !== undefined && accessTokenExpiresAt <= Date.now() + 30_000)) {
    try {
      await refreshAccessToken();
    } catch (error) {
      if (error instanceof SessionRefreshError && error.terminal) await invalidateSession();
      else scheduleRealtimeReconnect();
      return;
    }
  }
  if (!accessToken || realtimeSocket) return;
  const token = accessToken;
  const socket = new WebSocket(realtimeURL());
  let authenticated = false;
  realtimeSocket = socket;
  socket.addEventListener('open', () => {
    if (realtimeSocket !== socket) return;
    socket.send(JSON.stringify({ type: 'authenticate', access_token: token }));
    clearRealtimePing();
    realtimePingTimer = setInterval(() => {
      if (realtimeSocket === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      else clearRealtimePing();
    }, 25_000);
  });
  socket.addEventListener('message', (event) => {
    if (realtimeSocket !== socket || typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as { type?: string; data?: Message | VoicePresenceChanged | ProfileUpdated | IncomingWebRTCSignal };
      if (message.type === 'authenticated') {
        authenticated = true;
        realtimeRefreshRequired = false;
        reconnectDelayMilliseconds = 1_000;
        sendToRenderers('realtime:connected');
      } else if (message.type === 'message.created' && message.data) {
        sendToRenderers('realtime:message-created', message.data);
      } else if (message.type === 'presence.changed' && message.data) {
        sendToRenderers('realtime:presence-changed', message.data);
      } else if (message.type === 'voice.presence.changed' && message.data) {
        sendToRenderers('realtime:voice-presence-changed', message.data);
      } else if (message.type === 'profile.updated' && message.data) {
        sendToRenderers('realtime:profile-updated', message.data);
      } else if (message.type === 'webrtc.signal' && isIncomingWebRTCSignal(message.data)) {
        const signal = message.data;
        console.info('[webrtc] signal received from backend', { channelID: signal.channel_id, fromUserID: signal.from_user_id, kind: signal.kind });
        sendToRenderers('realtime:webrtc-signal', signal);
      }
    } catch { /* Ignore invalid realtime payloads. */ }
  });
  socket.addEventListener('error', () => socket.close());
  socket.addEventListener('close', () => {
    clearRealtimePing();
    if (realtimeSocket === socket) {
      realtimeSocket = undefined;
      if (!authenticated) realtimeRefreshRequired = true;
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
async function storeTokens(tokens: Tokens): Promise<void> {
  if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new SessionRefreshError('The server returned an invalid session.', true);
  }
  accessToken = tokens.access_token;
  accessTokenExpiresAt = Date.now() + tokens.expires_in * 1_000;
  await saveRefreshToken(tokens.refresh_token);
  scheduleTokenRefresh();
}
async function refreshAccessToken(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await loadRefreshToken();
    if (!refreshToken) throw new SessionRefreshError('The saved session is unavailable.', true);
    let response: Response;
    try {
      response = await fetch(backendURL + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      throw new SessionRefreshError('Unable to renew the session while offline.', false);
    }
    if (!response.ok) {
      throw new SessionRefreshError(await responseMessage(response, 'Unable to renew the session.'), response.status === 401 || response.status === 403);
    }
    await storeTokens(await response.json() as Tokens);
  })().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}
async function ensureValidAccessToken(): Promise<string> {
  if (!accessToken) throw new Error('No active session.');
  if (accessTokenExpiresAt !== undefined && accessTokenExpiresAt <= Date.now() + 30_000) {
    try {
      await refreshAccessToken();
    } catch (error) {
      if (error instanceof SessionRefreshError && error.terminal) await invalidateSession();
      throw error;
    }
  }
  if (!accessToken) throw new Error('No active session.');
  return accessToken;
}
async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === 'string' && body.message.trim() ? body.message : fallback;
  } catch {
    return fallback;
  }
}
async function fetchCurrentUser(token: string): Promise<User> {
  const response = await fetch(backendURL + '/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('Session is invalid.');
  return response.json() as Promise<User>;
}
async function authenticate(pathname: string, body: Record<string, string>): Promise<User> {
  const response = await fetch(backendURL + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Authentication failed.');
  const tokens = await response.json() as Tokens;
	const user = await fetchCurrentUser(tokens.access_token);
	await storeTokens(tokens);
	void connectRealtime();
	return user;
}
async function authenticatedRequest<T>(pathname: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const request = async (token: string): Promise<Response> => fetch(backendURL + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let response = await request(await ensureValidAccessToken());
  if (response.status === 401) {
    try {
      await refreshAccessToken();
    } catch (error) {
      if (error instanceof SessionRefreshError && error.terminal) await invalidateSession();
      throw new Error('Session expired. Sign in again.');
    }
    response = await request(await ensureValidAccessToken());
  }
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
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#14161d',
            symbolColor: '#f3f4f8',
            height: 40,
          },
        }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  primaryWindow = window;
  window.once('closed', () => {
    if (primaryWindow === window) primaryWindow = undefined;
  });
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback((permission === 'media' || permission === 'display-capture') && isTrustedRendererURL(webContents.getURL()));
  });
  window.webContents.on('console-message', (event) => {
    if (event.message.startsWith('[webrtc]')) console.info(`[renderer] ${event.message}`);
  });
  window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    const source = selectedDisplaySource;
    selectedDisplaySource = undefined;
    if (!source) {
      callback({});
      return;
    }

    callback({ video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !input.control && !input.alt && !input.meta) {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  if (debugEnabled) window.webContents.openDevTools({ mode: 'detach' });
  window.once('ready-to-show', () => onReady(window));

  const rendererURL = process.env['ELECTRON_RENDERER_URL'];
  if (rendererURL) {
    await window.loadURL(rendererURL);
    return window;
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'desktop', 'browser', 'index.html'));
  return window;
}

ipcMain.handle('app:relaunch', (): void => { app.relaunch(); app.exit(0); });
ipcMain.handle('settings:get', () => ({ ...appSettings, active: hardwareAccelerationActive, appVersion: desktopAppVersion() }));
ipcMain.handle('settings:set-hardware-acceleration', (_event, enabled: unknown): { restartRequired: boolean } => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid hardware acceleration setting.');
  appSettings.hardwareAcceleration = enabled;
  writeSettings(appSettings);
  return { restartRequired: enabled !== hardwareAccelerationActive };
});
ipcMain.handle('settings:set-noise-filter', (_event, enabled: unknown): void => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid noise filter setting.');
  appSettings.noiseFilter = enabled;
  writeSettings(appSettings);
});
ipcMain.handle('settings:set-audio', (_event, patch: unknown): AppSettings => {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid audio settings.');
  const value = patch as Partial<AppSettings>;
  if (value.inputVolumeDb !== undefined) {
    if (typeof value.inputVolumeDb !== 'number' || !Number.isFinite(value.inputVolumeDb)) throw new Error('Invalid input volume.');
    appSettings.inputVolumeDb = Math.min(30, Math.max(-30, value.inputVolumeDb));
  }
  if (value.inputDeviceId !== undefined) appSettings.inputDeviceId = typeof value.inputDeviceId === 'string' && value.inputDeviceId ? value.inputDeviceId : null;
  if (value.outputDeviceId !== undefined) appSettings.outputDeviceId = typeof value.outputDeviceId === 'string' && value.outputDeviceId ? value.outputDeviceId : null;
  if (value.outputVolume !== undefined) {
    if (typeof value.outputVolume !== 'number' || !Number.isFinite(value.outputVolume)) throw new Error('Invalid output volume.');
    appSettings.outputVolume = Math.min(2, Math.max(0, value.outputVolume));
  }
  writeSettings(appSettings);
  return { ...appSettings };
});
ipcMain.handle('settings:set-participant-audio', (_event, userID: unknown, preference: unknown): void => {
  if (typeof userID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userID)) throw new Error('Invalid participant ID.');
  if (preference === null) {
    delete appSettings.participantAudioPreferences[userID];
  } else {
    const parsed = participantAudioPreferences({ [userID]: preference })[userID];
    if (!parsed) throw new Error('Invalid participant audio preference.');
    appSettings.participantAudioPreferences[userID] = parsed;
  }
  writeSettings(appSettings);
});

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
ipcMain.handle('auth:register', async (_event, username: unknown, email: unknown, password: unknown): Promise<User> => {
  if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') throw new Error('Invalid registration input.');
  const response = await fetch(backendURL + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, 'Unable to create the account.'));
  return authenticate('/auth/login', { identity: username, password });
});
ipcMain.handle('auth:current-session', async (): Promise<User | null> => {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) return null;
  try {
    await refreshAccessToken();
    const user = await fetchCurrentUser(await ensureValidAccessToken());
    void connectRealtime();
    return user;
  } catch (error) {
    if (error instanceof SessionRefreshError && error.terminal) await invalidateSession();
    return null;
  }
});
ipcMain.handle('auth:update-avatar', (_event, avatarID: unknown): Promise<User> => {
  if (avatarID !== null && (typeof avatarID !== 'string' || !/^icon_(0[1-9]|1[0-5])$/.test(avatarID))) throw new Error('Invalid avatar.');
  return authenticatedRequest<User>('/me/avatar', 'PATCH', { avatar_id: avatarID as string | null });
});
ipcMain.handle('auth:logout', async (): Promise<void> => {
  const refreshToken = await loadRefreshToken();
  if (refreshToken) await fetch(backendURL + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => undefined);
  clearRefreshTimer();
  disconnectRealtime();
  accessToken = undefined;
  accessTokenExpiresAt = undefined;
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
ipcMain.handle('voice:get-webrtc-configuration', (event): { iceServers: Array<{ urls: string }> } => {
  if (!isTrustedRendererURL(event.sender.getURL())) throw new Error('Untrusted WebRTC configuration request.');
  return { iceServers: [{ urls: webRTCStunURL }] };
});
ipcMain.handle('voice:set-presence', (_event, channelID: unknown): Promise<void> => {
  if (channelID !== null && (typeof channelID !== 'number' || !Number.isSafeInteger(channelID) || channelID <= 0)) throw new Error('Invalid voice channel ID.');
  return authenticatedRequest<void>('/voice/presence', 'PUT', { channel_id: channelID as number | null });
});
ipcMain.handle('realtime:send-webrtc-signal', (event, signal: unknown): void => {
  if (!isTrustedRendererURL(event.sender.getURL()) || !isWebRTCSignal(signal) || !realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) throw new Error('Realtime signaling is unavailable.');
  console.info('[webrtc] signal sent to backend', { channelID: signal.channel_id, toUserID: signal.to_user_id, kind: signal.kind });
  realtimeSocket.send(JSON.stringify({ type: 'webrtc.signal', data: signal }));
});
ipcMain.handle('screen-share:list-sources', async (event): Promise<DisplaySource[]> => {
  if (!isTrustedRendererURL(event.sender.getURL())) throw new Error('Untrusted screen-share request.');
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  cachedDisplaySources = sources;
  return sources
    .map((source): DisplaySource => {
      const kind = source.id.startsWith('screen:') ? 'screen' as const : 'window' as const;
      const icon = source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined;
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        icon,
        kind,
        category: kind === 'screen' ? 'screen' : icon ? 'application' : 'window',
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
});
ipcMain.handle('screen-share:select-source', async (event, sourceID: unknown): Promise<void> => {
  if (!isTrustedRendererURL(event.sender.getURL()) || typeof sourceID !== 'string' || !sourceID) throw new Error('Invalid screen-share source.');
  const source = cachedDisplaySources.find((item) => item.id === sourceID)
    ?? (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } })).find((item) => item.id === sourceID);
  if (!source) throw new Error('Screen-share source is no longer available.');
  selectedDisplaySource = source;
});
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
    const desktopUpdater = new DesktopUpdaterService({
      adapter: new ElectronAutoUpdaterAdapter(),
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      publishStatus: (status) => {
        const window = primaryWindow;
        if (!window || window.isDestroyed() || !isTrustedRendererURL(window.webContents.getURL())) return;
        window.webContents.send(DESKTOP_UPDATER_CHANNELS.statusChanged, status);
      },
    });
    registerDesktopUpdaterIPC(desktopUpdater, isTrustedRendererURL);

    const splash = createSplashWindow();
    const splashStartedAt = Date.now();
    await createWindow((window) => {
      const remainingSplashMilliseconds = Math.max(0, 3_000 - (Date.now() - splashStartedAt));
      setTimeout(() => {
        window.show();
        if (!splash.isDestroyed()) splash.close();
      }, remainingSplashMilliseconds);
    });
    try {
      desktopUpdater.start();
    } catch (error: unknown) {
      console.error('[updater] initialization failed', error instanceof Error ? error.message : String(error));
    }

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
