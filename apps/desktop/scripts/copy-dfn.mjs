import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(appRoot, 'node_modules', '@lofcz', 'deepfilternet-web', 'dist');
const destination = join(appRoot, 'src', 'assets', 'df');
mkdirSync(destination, { recursive: true });
copyFileSync(join(source, 'df_bg.wasm'), join(destination, 'df_bg.wasm'));
copyFileSync(join(source, 'worklet.js'), join(destination, 'dfn-worklet.js'));
console.log('[dfn] denoiser assets copied to src/assets/df');
