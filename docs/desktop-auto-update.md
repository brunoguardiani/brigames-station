# Desktop automatic updates

The desktop updater uses `electron-updater` with the metadata produced by
`electron-builder`. The first supported automatic-update path is the packaged
Windows x64 NSIS application. Development runs never contact an update feed.

## User flow

After a packaged application starts, it waits briefly before checking for a
newer version. Further checks are infrequent and happen in the background.
When a release is found, the installer downloads without blocking the rest of
the application. The renderer receives only a small typed status object through
the preload boundary; update URLs, credentials, file paths, and provider
configuration never cross into Angular.

Once the download is complete, the user can choose:

- **Reiniciar e atualizar** to close the application, apply the downloaded
  installer, and reopen it;
- **Depois** to keep using the current process. Because installation on normal
  application exit is enabled, the downloaded update is applied on a later
  shutdown.

Download and provider failures are logged and represented as an updater state,
but they do not terminate Electron or interrupt the current session. A typed
manual-check IPC method is available for a future settings screen without
exposing arbitrary IPC or feed controls.

## Windows installation appearance

The actual installation uses a compact borderless window, with a centered
Brigames mascot, dark background, larger Portuguese text and a thin purple
progress bar. The title bar, wizard buttons and separators are hidden while
files are being replaced, after Electron has closed. The progress remains
driven by NSIS; it is not an estimated animation in Angular.

`apps/desktop/installer/update-window.nsh` supplies this custom surface over
the existing NSIS installation page, scaled to the window's DPI. It preserves
the real progress control and restores the standard result controls on errors,
reboot requests or failed launch. Initial setup pages,
uninstallation and operating-system elevation prompts retain their standard
controls. No additional browser/runtime or updater process is required.

`apps/desktop/installer/brigames-installer.nsh` extends electron-builder's
assisted installer through `nsis.include`. It preserves the standard install
directory, elevation, shortcut, upgrade and uninstall handling. The same
branding is used for manual installation; updates skip the existing setup
pages using electron-builder's `--updated` flag.

Explicit **Reiniciar e atualizar** requests keep `quitAndInstall(false, true)`
and `autoRunAppAfterInstall = true`, so Windows shows the branded installation
window and passes `--updated --force-run`. On successful installation, the
custom finish callback launches the app with electron-builder's existing
`StdUtils.ExecShellAsUser` mechanism and closes the installer without requiring
a **Concluir** click. Successful visible manual installations and updates
without `--force-run` also open the app immediately. There is no launch checkbox
or confirmation. Aborted installs never auto-launch; reboot-required results
retain the native reboot choices. Failed launch requests show an explanation
and instructions to open the app using its shortcut. Installation on ordinary application exit keeps
the existing silent behavior and does not force the application to reopen.

The committed BMP assets are independent of the ignored `build/` directory and
are available in fresh CI checkouts. To regenerate them from the existing logo
on Windows (System.Drawing, no additional graphics dependency):

```powershell
powershell -NoProfile -File apps/desktop/scripts/create-windows-installer-assets.ps1
```

Validate the generated NSIS artifact with `dist:win`, in addition to the updater
tests. For a release test, exercise a manual install, an explicit update from
an older version, a deferred update on exit, installation failure and a
reboot-required outcome. Confirm that successful visible installations open
the app once without showing the finish screen or a launch checkbox, while
deferred silent updates do not force a relaunch. UI-only simulations can verify the callbacks and
appearance, but do not replace an end-to-end update between packaged releases.

## Release assets

The manually triggered `Release desktop applications` workflow must publish
the installer and updater metadata from the same build. In particular:

| Platform | Required updater assets |
| --- | --- |
| Windows NSIS | `latest.yml`, the `.exe`, and its `.exe.blockmap` |
| macOS | `latest-mac.yml`, ZIP payloads, and ZIP blockmaps |
| Linux AppImage | `latest-linux.yml` and the referenced AppImage |

The SHA-256 sidecars remain useful for a person verifying a manual download.
They are not used by `electron-updater`, which validates the SHA-512 value in
the generated manifest. Never hand-edit a manifest or combine it with an
installer from another build.

The version used for discovery is `version` in
`apps/desktop/package.json`. A real update test therefore needs two packaged
versions: install an older release, publish a higher semantic version, then
launch the older application.

## Public-feed requirement

The current repository and its GitHub Releases are private. A GitHub Release
inherits repository visibility, so an installed application cannot read its
manifest anonymously. Although `electron-updater` can technically use a GitHub
token for a private repository, embedding such a token in a distributed desktop
application would expose it to every user and is not supported by this project.

Before automatic updates are enabled for users, choose one publicly readable
feed:

1. make the current release repository public;
2. publish the desktop assets to a separate public releases-only repository;
3. switch the builder provider to a public generic HTTPS bucket or CDN.

The package currently identifies the existing GitHub repository as its
provider so all correct metadata is generated. If the repository remains
private, replace that provider with the selected public destination in both the
builder configuration and release workflow. CI may use a scoped publishing
credential; that credential must never be packaged in the app.

### CI credentials

Publishing into the current repository uses the short-lived `GITHUB_TOKEN`
provided automatically by Actions with `contents: write`; no additional update
secret is required. `DISCORD_WEBHOOK_URL` is used only by the existing release
notification and is unrelated to update discovery.

A separate releases repository would require a narrowly scoped CI secret with
permission to create releases in that repository, plus corresponding workflow
changes. A future Windows signing setup can use electron-builder's `CSC_LINK`
and `CSC_KEY_PASSWORD` environment secrets (or an equivalent managed signing
service). At that point, remove the current `win.signExecutable: false` opt-out
from `apps/desktop/package.json`. None of these values may be placed in
`package.json`, `app-update.yml`, preload, renderer code, or a Release asset.

## Signing and platform differences

- **Windows:** NSIS supports the implemented flow even without code signing,
  but unsigned builds still show an unknown-publisher/SmartScreen warning.
  Production distribution should use one stable code-signing certificate kept
  only in CI secrets. Signing improves publisher identity and trust; it is not
  the mechanism that discovers an update.
- **macOS:** the updater consumes a ZIP payload in addition to the DMG used for
  manual installation. The workflow now retains both, but reliable macOS
  updates also require signing (with a consistent identity) and notarization.
  The current unsigned macOS build is therefore not production-ready for
  automatic updates.
- **Linux:** AppImage has an application-level update path; `.deb` installations
  remain package-manager managed. Keep the documented manual update path until
  Linux updater behavior has been validated on the supported distribution.

## Verification

From the repository root:

```bash
pnpm --filter @brigames-station/desktop run test:updater
pnpm --filter @brigames-station/desktop run build
```

For the complete Windows artifact set, run on Windows:

```powershell
pnpm --filter @brigames-station/desktop run dist:win
Get-ChildItem apps/desktop/release/latest.yml, `
  apps/desktop/release/*.exe, `
  apps/desktop/release/*.exe.blockmap
```

Confirm that development mode reports updates as disabled and performs no
network request. For a packaged end-to-end test, install version `A`, publish a
non-draft public release `B` where `B > A`, start `A`, wait for the background
download, and exercise both **Depois** and **Reiniciar e atualizar**.
