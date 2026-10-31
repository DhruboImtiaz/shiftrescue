import { MAX_PROPOSAL_CHARACTERS } from './limits.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './cloud.mjs';

// A signed, short-lived preview survives independent Netlify invocations.
export function proposalTokens(secret, now = () => Date.now()) {
  function sign(payload) {
    if (typeof secret !== 'string' || secret.length < 32 || /replace_with|your_random_secret/i.test(secret)) throw new AppError('Set PROPOSAL_SECRET to a random value of at least 32 characters on the server.', 503);
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
  return {
    issue(proof) {
      const payload = Buffer.from(JSON.stringify({ ...proof, expires: now() + 600000 })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    read(token, userId, eventId) {
      const expired = () => new AppError('This repair preview expired or belongs to another event. Generate a new preview.', 409);
      if (typeof token !== 'string' || token.length > MAX_PROPOSAL_CHARACTERS) throw expired();
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) throw expired();
      const expected = Buffer.from(sign(payload)); const supplied = Buffer.from(signature);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw expired();
      let proof; try { proof = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw expired(); }
      if (proof.expires <= now() || proof.userId !== userId || proof.eventId !== eventId) throw expired();
      return proof;
    }
  };
}
