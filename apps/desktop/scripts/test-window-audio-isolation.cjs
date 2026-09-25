// Manual Windows smoke test. Plays two quiet tones in separate processes and
// verifies that capture of one process contains 440 Hz but excludes 1000 Hz.
const assert = require('node:assert/strict');
const { spawn, fork, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows.');
const packaged = process.argv.includes('--packaged');
const packageRoot = path.join(__dirname, '../out/window-audio-package/win-unpacked');
// Advanced IPC serialization must use the same V8 version on both ends.
if (!process.versions.electron) {
  const result = spawnSync(packaged ? path.join(packageRoot, 'brigames-station.exe') : require('electron'), [__filename, ...(packaged ? ['--packaged'] : [])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit', timeout: 30_000,
  });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}
fs.mkdirSync(path.join(__dirname, '../out'), { recursive: true });
const directory = fs.mkdtempSync(path.join(__dirname, '../out/audio-isolation-'));
const children = [];
function wav(frequency) {
  const frames = 48000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * frequency * i / 48000)), 44 + i * 2);
  const file = path.join(directory, `${frequency}.wav`);
  fs.writeFileSync(file, bytes);
  return file;
}
async function play(frequency) {
  const file = wav(frequency).replace(/'/g, "''");
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$sound = [System.Media.SoundPlayer]::new('${file}'); $sound.Load(); $sound.PlayLooping(); Write-Output 'ready'; Start-Sleep -Seconds 15`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tone startup timed out')), 10000);
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Tone exited early')); });
  });
  return child;
}
function strength(samples, frequency) {
  let total = 0;
  const size = 4800;
  let count = 0;
  for (let offset = 0; offset + size <= samples.length; offset += size) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < size; i++) {
      const phase = 2 * Math.PI * frequency * i / 48000;
      real += samples[offset + i] * Math.cos(phase);
      imaginary += samples[offset + i] * Math.sin(phase);
    }
    total += 2 * Math.hypot(real, imaginary) / size; count++;
  }
  return total / count;
}
(async () => {
  try {
    const target = await play(440);
    await play(1000);
    const chunks = [];
    const workerPath = packaged ? path.join(packageRoot, 'resources/app.asar/dist-electron/window-audio-worker.js') : path.join(__dirname, '../dist-electron/window-audio-worker.js');
    const addonPath = packaged ? path.join(packageRoot, 'resources/window-audio/addon.node') : require.resolve('@kokapuk/application-loopback');
    const worker = fork(workerPath, [addonPath, String(target.pid)], {
      execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
    });
    children.push(worker);
    worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native startup timed out')), 10000);
      worker.on('message', (message) => {
        if (message.type === 'ready') { clearTimeout(timer); resolve(); }
        if (message.type === 'pcm') chunks.push(Buffer.from(message.pcm));
      });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
      worker.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Native worker exited: ${code}`)); });
    });
    await delay(2200);
    const bytes = Buffer.concat(chunks);
    const samples = Array.from({ length: Math.floor(bytes.length / 4) }, (_, i) => bytes.readInt16LE(i * 4) / 32768);
    const selected = strength(samples, 440), other = strength(samples, 1000);
    console.log(JSON.stringify({ capturedFrames: samples.length, selectedTone: selected, otherAppTone: other }));
    assert.ok(samples.length >= 48000, 'Native capture should deliver at least one second of audio');
    assert.ok(selected > 0.001, 'The selected process tone must be audible');
    assert.ok(other < selected * 0.1, 'The unrelated process tone must be excluded');
    console.log('PASS: selected application audio is isolated');
  } finally {
    for (const child of children) child.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
