import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const api = await import('./smoke.mjs').catch(() => ({}));
const manifestPath = new URL('./manifest.json', import.meta.url);

test('runs both locally built Forks through real actions and shutdown', async () => {
  assert.equal(typeof api.runSmoke, 'function', 'smoke runner must exist');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const result = await api.runSmoke(manifest);
  assert.equal(result.buttonResult, 'clicked');
  assert.equal(result.inputValue, 'ActionDriver baseline');
  assert.ok(result.imageSize.width > 0 && result.imageSize.height > 0);
  assert.equal(result.closedPageRejected, true);
  assert.deepEqual(result.cleanup, { electronExited: true, httpClosed: true });
});

test('cleans up the real Electron process and server after a failed action', async () => {
  assert.equal(typeof api.runSmoke, 'function', 'smoke runner must exist');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let error;
  try { await api.runSmoke(manifest, { injectFailure: true }); } catch (caught) { error = caught; }
  assert.ok(error, 'missing target must fail');
  assert.match(error.message, /Timeout/);
  assert.deepEqual(error.cleanup, { electronExited: true, httpClosed: true });
});

test('rejects a runtime version mismatch and releases the process and server', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.electron.version = '0.0.0';
  let error;
  try { await api.runSmoke(manifest); } catch (caught) { error = caught; }
  assert.ok(error, 'wrong runtime version must fail');
  assert.match(error.message, /VERSION_MISMATCH: Electron/);
  assert.deepEqual(error.cleanup, { electronExited: true, httpClosed: true });
});
