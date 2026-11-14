import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.ts';

const originalFetch = globalThis.fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const rejects = (action: () => Promise<unknown>, status: number, message: RegExp) =>
  assert.rejects(action, error => error instanceof ApiError && error.status === status && message.test(error.message));
try {
  const profile = { id: 'champion', coins: 35, build: { weaponId: 'starter' } };
  globalThis.fetch = async () => json(profile);
  assert.deepEqual(await api.profile(), profile);
  globalThis.fetch = async () => json(null);
  assert.equal(await api.currentDuel(), null, 'no active Duel remains a valid null response');

  globalThis.fetch = async () => new Response('<html>Unavailable</html>', { status: 200 });
  await rejects(() => api.profile(), 0, /response could not be read/);
  await rejects(() => api.upgrade('weapon', 'retained-intent'), 0, /response could not be read/);
  globalThis.fetch = async () => json({ error: 'Rejected request.' }, 400);
  await rejects(() => api.upgrade('weapon', 'rejected-intent'), 400, /Rejected request/);
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  await rejects(() => api.nft(), 503, /response could not be read/);
  globalThis.fetch = async () => json({ error: 'Unexpected error response.' });
  await rejects(() => api.profile(), 0, /Unexpected error response/);

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await rejects(() => api.profile(), 0, /Connection lost/);
  globalThis.fetch = async () => { throw new DOMException('Timeout', 'TimeoutError'); };
  await rejects(() => api.market(), 0, /request timed out/);
  console.log('API recovery: PASS (valid null, unreadable success, uncertain write, HTTP errors, network loss, timeout)');
} finally {
  globalThis.fetch = originalFetch;
}
