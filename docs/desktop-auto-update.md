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
