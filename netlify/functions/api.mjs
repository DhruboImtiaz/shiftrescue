import { createApi } from '../../src/api.mjs';
const handle = createApi({ ...process.env, NETLIFY: 'true', COOKIE_SECURE: 'true' });
export default request => handle(request);
export const config = {
  path: '/api/*',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 90 }
};
