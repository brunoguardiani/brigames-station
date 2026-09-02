const { adHocSignAfterPack } = require('electron-sparkle-updater/builder');

module.exports = async function afterPack(context) {
  // electron-builder creates two temporary apps before @electron/universal
  // merges them. Signing either temporary bundle changes architecture-specific
  // CodeResources files and makes the universal merge reject the inputs as
  // non-identical. The builder invokes afterPack again for the merged app, so
  // defer ad-hoc signing until that final invocation.
  if (/-universal-(?:x64|arm64)-temp$/.test(context.appOutDir)) return;

  await adHocSignAfterPack(context);
};
