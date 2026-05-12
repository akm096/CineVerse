import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'www');

const copyItems = [
  ['index.html', 'index.html'],
  ['player.html', 'player.html'],
  ['library-admin.html', 'library-admin.html'],
  ['css', 'css'],
  ['js', 'js'],
  ['functions', 'functions'],
  ['gdrive-worker.js', 'gdrive-worker.js'],
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [source, target] of copyItems) {
  const from = path.join(root, source);
  if (!existsSync(from)) continue;

  await cp(from, path.join(outDir, target), {
    recursive: true,
    force: true,
  });
}

console.log('Prepared Capacitor web assets in www/');
