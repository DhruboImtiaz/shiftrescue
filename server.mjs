import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApi, securityHeaders } from './src/api.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
let fileConfig = {};
try { fileConfig = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const env = { ...fileConfig, ...process.env };
async function saveEnv() {
  const temp = path.join(root, '.env.tmp');
  await writeFile(temp, Object.entries(fileConfig).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  await rename(temp, path.join(root, '.env'));
}
if (!env.PROPOSAL_SECRET || /replace_with|your_random_secret/i.test(env.PROPOSAL_SECRET)) { fileConfig.PROPOSAL_SECRET = env.PROPOSAL_SECRET = randomBytes(32).toString('hex'); await saveEnv(); }
const handle = createApi(env, { saveConnection: async proposed => { fileConfig.GEMINI_API_KEY = proposed.key; fileConfig.GEMMA_MODEL = proposed.model; await saveEnv(); } });
const port = Number(env.PORT || 5173);
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/scheduler.mjs', ['../src/scheduler.mjs', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
assets.set('/setup.mjs', ['../src/setup.mjs', 'text/javascript; charset=utf-8']);
assets.set('/event-setup.js', ['event-setup.js', 'text/javascript; charset=utf-8']);
assets.set('/voice.js', ['voice.js', 'text/javascript; charset=utf-8']);
assets.set('/photo.js', ['photo.js', 'text/javascript; charset=utf-8']);
assets.set('/workspace.js', ['workspace.js', 'text/javascript; charset=utf-8']);
assets.set('/profile.js', ['profile.js', 'text/javascript; charset=utf-8']);
assets.set('/landing-drafts.html', ['landing-drafts.html', 'text/html; charset=utf-8']);
assets.set('/landing-drafts.css', ['landing-drafts.css', 'text/css; charset=utf-8']);
assets.set('/landing-drafts.js', ['landing-drafts.js', 'text/javascript; charset=utf-8']);
assets.set('/landing-assets/volunteer-community.png', ['landing-assets/volunteer-community.png', 'image/png']);
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(host)) { res.writeHead(403); return res.end('Invalid local host.'); }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }) });
      const response = await handle(request);
      const headers = Object.fromEntries(response.headers); const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers); return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (req.method !== 'GET' || !assets.has(url.pathname)) { res.writeHead(404); return res.end('Not found.'); }
    const [file, type] = assets.get(url.pathname);
    res.writeHead(200, { ...securityHeaders, 'Content-Type': type }); res.end(await readFile(path.join(root, 'public', file)));
  } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'The server could not complete this request.' })); }
});
server.listen(port, '127.0.0.1', () => console.log(`ShiftRescue is running at http://127.0.0.1:${port}`));
