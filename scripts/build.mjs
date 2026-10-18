import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { securityHeaders } from '../src/api.mjs';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../src/scheduler.mjs', import.meta.url), new URL('../dist/scheduler.mjs', import.meta.url));
await writeFile(new URL('../dist/_headers', import.meta.url), '/*\n' + Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`).join('\n') + '\n');
console.log('Built static assets in dist/. The API is bundled separately as a Netlify Function.');
