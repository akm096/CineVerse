import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const jsTargets = [
  'js/app.js',
  'js/account.js',
  'js/player.js',
  'js/chat.js',
  'js/cineverse-bridge.js',
  'js/subtitles.js',
  'js/library-admin.js',
  'js/pwa.js',
  'sw.js',
  'functions/hls.js',
  'functions/sibnet.js',
  'functions/api/[[path]].js',
  'functions/proxy.js',
  'scripts/prepare-web.mjs'
];

for (const target of jsTargets) {
  await run('node', ['--check', target]);
}

const migrations = (await readdir(path.join(root, 'migrations')))
  .filter(file => /^\d{4}_.+\.sql$/.test(file))
  .sort();

for (let i = 0; i < migrations.length; i++) {
  const expected = String(i + 1).padStart(4, '0');
  if (!migrations[i].startsWith(expected)) {
    throw new Error(`Migration order gap: expected ${expected}, got ${migrations[i]}`);
  }
}

console.log(`Verified ${jsTargets.length} JS files and ${migrations.length} migrations.`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code}`));
    });
  });
}
