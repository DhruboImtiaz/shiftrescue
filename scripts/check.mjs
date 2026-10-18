import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'public', 'netlify/functions', 'scripts', 'test', '.']) {
  for (const file of await readdir(dir)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const run = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status || 1);
  }
}
console.log('All JavaScript syntax checks passed.');
