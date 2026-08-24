import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop');
const releaseDirectory = resolve(desktopDirectory, 'release');
const desktopPackagePath = resolve(desktopDirectory, 'package.json');
const argumentsList = process.argv.slice(2);

const unsupportedArguments = argumentsList.filter((argument) => argument !== '--skip-install');

if (unsupportedArguments.length > 0) {
  console.error(`Argumentos nao reconhecidos: ${unsupportedArguments.join(', ')}`);
  console.error('Uso: node scripts/build-desktop-installer.mjs [--skip-install]');
  process.exit(1);
}

const targetByPlatform = {
  win32: {
    name: 'Windows x64',
    command: 'dist:win',
    supportedArchitectures: new Set(['x64']),
    matchesArtifact: (fileName, version) => fileName === `brigames-station-Setup-${version}.exe`,
  },
  darwin: {
    name: 'macOS',
    command: 'dist:mac',
    supportedArchitectures: new Set(['x64', 'arm64']),
    matchesArtifact: (fileName, version) => fileName.startsWith(`brigames-station-${version}`) && fileName.endsWith('.dmg'),
  },
  linux: {
    name: 'Linux x64',
    command: 'dist:linux',
    supportedArchitectures: new Set(['x64']),
    matchesArtifact: (fileName, version) =>
      fileName.startsWith(`brigames-station-${version}-`) &&
      (fileName.endsWith('.AppImage') || fileName.endsWith('.deb')),
  },
};

const target = targetByPlatform[process.platform];

if (!target) {
  console.error(`Sistema operacional sem target configurado: ${process.platform}`);
  process.exit(1);
}

if (!target.supportedArchitectures.has(process.arch)) {
  console.error(`${target.name} requer uma maquina com arquitetura compativel; arquitetura atual: ${process.arch}.`);
  process.exit(1);
}

const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8'));
const version = desktopPackage.version;
const pnpmCommand = 'pnpm';

function run(description, commandArguments) {
  console.log(`\n==> ${description}`);
  const commonOptions = { cwd: repositoryRoot, stdio: 'inherit' };
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [pnpmCommand, ...commandArguments].join(' ')], commonOptions)
    : spawnSync(pnpmCommand, commandArguments, commonOptions);

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!argumentsList.includes('--skip-install')) {
  run('Instalando dependencias do workspace', ['install', '--frozen-lockfile']);
}

run(`Gerando instalador para ${target.name}`, ['--filter', '@brigames-station/desktop', 'run', target.command]);

if (!existsSync(releaseDirectory)) {
  console.error(`Diretorio de release nao encontrado: ${releaseDirectory}`);
  process.exit(1);
}

const artifacts = readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && target.matchesArtifact(entry.name, version))
  .map((entry) => resolve(releaseDirectory, entry.name));

if (artifacts.length === 0) {
  console.error(`Nenhum instalador da versao ${version} foi encontrado em ${releaseDirectory}.`);
  process.exit(1);
}

for (const artifactPath of artifacts) {
  const checksum = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
  const artifactName = artifactPath.split(/[\\/]/).pop();
  const checksumPath = `${artifactPath}.sha256`;

  writeFileSync(checksumPath, `${checksum}  ${artifactName}\n`, 'utf8');
  console.log(`Instalador: ${artifactPath}`);
  console.log(`SHA-256:    ${checksumPath}`);
}
