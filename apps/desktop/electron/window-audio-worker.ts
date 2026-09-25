// Run the native addon in a disposable child: a driver/addon failure must not
// take down the call or keep capturing after the renderer has gone away.
const addon = require(process.argv[2]) as {
  startLoopbackCapture(pid: number, chunk: (pcm: Uint8Array) => void, ended: () => void): void;
};
try {
  let sending = false;
  addon.startLoopbackCapture(Number(process.argv[3]), (pcm) => {
    if (sending || !process.connected) return;
    sending = true;
    process.send?.({ type: 'pcm', pcm }, () => { sending = false; });
  }, () => process.exit(0));
  process.send?.({ type: 'ready' });
} catch {
  process.exit(1);
}
process.on('disconnect', () => process.exit(0));
