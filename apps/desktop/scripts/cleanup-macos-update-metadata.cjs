const fs = require('node:fs');
const path = require('node:path');

const releaseDirectory = path.join(__dirname, '..', 'release');
if (!fs.existsSync(releaseDirectory)) process.exit(0);

for (const name of fs.readdirSync(releaseDirectory)) {
  if (name === 'latest-mac.yml' || name.endsWith('-mac.zip.blockmap')) {
    fs.unlinkSync(path.join(releaseDirectory, name));
  }
}
