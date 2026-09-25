# Window audio capture

On Windows x64, sharing a window captures the audio of the process that owns its
HWND, including child processes. It does not capture unrelated applications.
Multiple windows or browser tabs in that process can contribute audio.

Electron's `loopback` audio is granted only for full-screen sources. Linux
monitor-device capture is also limited to full-screen sharing. Window sharing on
Linux and macOS is video-only. If native capture is unavailable or fails, the UI
reports that the stream has no audio; it never falls back to system audio.

The Windows implementation uses the pinned N-API binary from
`@kokapuk/application-loopback@1.0.2`. It is a development dependency because only
its Windows x64 binary is copied into `resources/window-audio/addon.node` by
electron-builder. Its install script is disabled: macOS and Linux must not build
this Windows-only addon. Native capture runs in a disposable Electron child
process with the same V8 version as the main process. Stopping or replacing the
stream, navigating/reloading the renderer, renderer failure, and application exit
terminate capture. Driver/native-addon failures are isolated from the call.

Requires Windows process-loopback support and an
available audio output device. The process ID is resolved from the exact HWND
with `GetWindowThreadProcessId`; window titles are never used to choose audio.

## Verification

- `pnpm --filter @brigames-station/desktop test`: regression tests for source
  grants, pending membership snapshots, PCM conversion and capture cleanup.
- `pnpm --filter @brigames-station/desktop build`: Angular and Electron build.
- After building, run `node scripts/test-window-audio-isolation.cjs` from
  `apps/desktop` on Windows. It plays two quiet tones in separate processes and
  verifies the selected tone is captured and the unrelated tone is excluded.
- To check packaging too, build with `electron-builder --config
  electron-builder.config.js --win --x64 --dir --publish never
  --config.directories.output=out/window-audio-package`, then run the same smoke
  test with `--packaged`. This exercises the worker inside `app.asar` and the
  native binary copied into the Windows application resources.
- Manual call check: A and B join a voice channel; C accepts an invitation and
  joins the same channel. Verify C appears without reconnecting A or B, including
  when C joins during a membership refresh. Check screen sharing in both
  directions, switching windows, stopping, and leaving the call.

References: [Electron display capture](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts),
[Windows application loopback](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/).
