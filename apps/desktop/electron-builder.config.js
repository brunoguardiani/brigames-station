const { sparkleBuilderConfig } = require('electron-sparkle-updater/builder');

const isMacBuild = process.argv.includes('--mac')
  || (process.platform === 'darwin' && !process.argv.includes('--win') && !process.argv.includes('--linux'));
const sparkle = isMacBuild
  ? sparkleBuilderConfig({
      feedUrl: 'https://github.com/brunoguardiani/brigames-station/releases/latest/download/appcast.xml',
      publicEdKey: '1/K7+eGRHMy6hPZCqQcyVcgidr9F1LGrQbFCIE4c5Vo=',
    })
  : null;

module.exports = {
  appId: 'com.brigames-station.desktop',
  productName: 'brigames-station',
  executableName: 'brigames-station',
  ...(!isMacBuild ? {
    publish: [{ provider: 'github', owner: 'brunoguardiani', repo: 'brigames-station' }],
  } : {}),
  directories: { buildResources: 'build', output: 'release' },
  files: ['dist/**', 'dist-electron/**', 'package.json', ...(sparkle?.files ?? [])],
  extraResources: [{ from: 'src/assets', to: 'assets' }],
  asar: true,
  afterPack: 'scripts/after-pack.cjs',
  ...(sparkle ? {
    extraFiles: sparkle.extraFiles,
    asarUnpack: sparkle.asarUnpack,
    dmg: sparkle.dmg,
    // electron-builder 26 has no root `zip` option. Its unavoidable macOS
    // blockmap sidecars are removed after packaging by the cleanup script.
  } : {}),
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'src/assets/brigames-station-icon.png',
    artifactName: 'brigames-station-Setup-${version}.${ext}',
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      // Sparkle rejects multiple enclosures with the same bundle version.
      // Use one universal ZIP for updates while retaining architecture-specific
      // DMGs for the initial/manual installation.
      { target: 'zip', arch: ['universal'] },
    ],
    artifactName: 'brigames-station-${version}-${arch}-mac.${ext}',
    icon: 'build/brigames-station.icns',
    category: 'public.app-category.social-networking',
    extendInfo: {
      NSMicrophoneUsageDescription: 'O brigames-station usa o microfone para canais de voz.',
      NSCameraUsageDescription: 'O brigames-station usa a câmera quando você decide compartilhá-la em um canal de voz.',
      ...(sparkle?.mac.extendInfo ?? {}),
    },
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'src/assets/brigames-station-icon.png',
    category: 'Network;Chat;InstantMessaging',
    maintainer: 'Bruno Guardiani <brunodipaolo12@gmail.com>',
    syncDesktopName: true,
    artifactName: 'brigames-station-${version}-${arch}.${ext}',
  },
};
