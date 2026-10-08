import { app, ipcMain, type WebContents } from 'electron';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { windowHandle } from './display-media';
import { WindowAudioDelivery } from './window-audio-delivery';

const execute = promisify(execFile);

async function windowProcessID(sourceID: string): Promise<number> {
  // Resolve the HWND, never a title (two unrelated apps may have the same title).
  const handle = windowHandle(sourceID);
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WindowAudio { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId); }'; [uint32]$targetProcess = 0; [void][WindowAudio]::GetWindowThreadProcessId([IntPtr]::new(${handle}), [ref]$targetProcess); Write-Output $targetProcess`;
  const { stdout } = await execute(path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 });
  const pid = Number(stdout.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('The selected window is no longer available.');
  return pid;
}

export function registerWindowAudioIPC(isTrusted: (url: string) => boolean, isGranted: (owner: WebContents, sourceID: string) => boolean): void {
  type Capture = { owner: WebContents; child?: ChildProcess; delivery?: WindowAudioDelivery; cancel?: () => void };
  const captures = new Map<string, Capture>();
  const stop = (id: string): void => {
    const capture = captures.get(id);
    captures.delete(id);
    capture?.delivery?.stop();
    capture?.cancel?.();
    capture?.child?.kill();
  };
  const notifyEnded = (owner: WebContents, id: string): void => {
    if (owner.isDestroyed()) return;
    try { owner.send('screen-share:window-audio-ended', id); }
    catch (error) { console.warn('[window-audio] unable to notify capture end', error); }
  };
  const stopOwner = (owner: WebContents): void => {
    for (const [id, capture] of captures) if (capture.owner === owner) stop(id);
  };
  app.on('web-contents-created', (_event, owner) => {
    owner.on('destroyed', () => stopOwner(owner));
    owner.on('render-process-gone', () => stopOwner(owner));
    owner.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) stopOwner(owner); });
  });
  app.on('before-quit', () => { for (const id of captures.keys()) stop(id); });

  ipcMain.handle('screen-share:start-window-audio', async (event, sourceID: unknown, id: unknown) => {
    const owner = event.sender;
    if (!isTrusted(owner.getURL()) || process.platform !== 'win32' || process.arch !== 'x64'
      || typeof sourceID !== 'string' || !isGranted(owner, sourceID)
      || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || captures.has(id) || captures.size >= 2) {
      throw new Error('Window audio is unavailable for this capture.');
    }
    const capture: Capture = { owner };
    captures.set(id, capture);
    try {
      const pid = await windowProcessID(sourceID);
      if (captures.get(id) !== capture || owner.isDestroyed()) throw new Error('Capture was cancelled.');
      const addonPath = app.isPackaged
        ? path.join(process.resourcesPath, 'window-audio', 'addon.node')
        : require.resolve('@kokapuk/application-loopback');
      const child = capture.child = fork(path.join(__dirname, 'window-audio-worker.js'), [addonPath, String(pid)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, ...{ windowsHide: true },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
      });
      child.stderr?.resume();
      capture.delivery = new WindowAudioDelivery(
        (pcm, sequence) => owner.send('screen-share:window-audio-data', { id, pcm, sequence }),
        (error) => {
          console.warn('[window-audio] audio delivery failed', error);
          stop(id);
          notifyEnded(owner, id);
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Window audio capture timed out.')); stop(id); }, 10_000);
        capture.cancel = () => { clearTimeout(timer); reject(new Error('Capture was cancelled.')); };
        child.on('message', (message: { type?: string; pcm?: Uint8Array }) => {
          if (captures.get(id) !== capture || owner.isDestroyed()) return;
          if (message.type === 'ready') { clearTimeout(timer); capture.cancel = undefined; resolve(); }
          if (message.type === 'pcm' && message.pcm instanceof Uint8Array) capture.delivery?.deliver(message.pcm);
        });
        child.once('error', (error) => {
          clearTimeout(timer); reject(error);
          if (captures.get(id) !== capture) return;
          console.warn('[window-audio] capture worker failed', error);
          stop(id);
          notifyEnded(owner, id);
        });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          reject(new Error('Window audio capture stopped.'));
          if (captures.get(id) !== capture) return;
          capture.delivery?.stop();
          captures.delete(id);
          console.warn('[window-audio] capture worker exited unexpectedly', { code, signal });
          notifyEnded(owner, id);
        });
      });
    } catch (error) { stop(id); throw error; }
  });
  ipcMain.handle('screen-share:stop-window-audio', (event, id: unknown) => {
    if (typeof id === 'string' && captures.get(id)?.owner === event.sender) stop(id);
  });
  ipcMain.on('screen-share:window-audio-consumed', (event, id: unknown, sequence: unknown) => {
    if (typeof id !== 'string') return;
    const capture = captures.get(id);
    if (capture?.owner === event.sender) capture.delivery?.acknowledge(sequence);
  });
}
