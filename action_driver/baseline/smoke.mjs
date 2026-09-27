import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyManifest } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function timeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

export async function runSmoke(manifest, options = {}) {
  await verifyManifest(manifest);
  const { _electron } = require(manifest.playwright.modulePath);
  const coreRoot = path.dirname(manifest.playwright.modulePath);
  assert.equal(JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8')).version, manifest.playwright.version, 'VERSION_MISMATCH: Playwright');
  const html = await readFile(path.join(here, 'fixture.html'));
  const outputDir = path.resolve(here, '../../../build/verification');
  await mkdir(outputDir, { recursive: true });
  const server = createServer((request, response) => {
    if (request.url !== '/fixture') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  let app, child, result, failure;
  const cleanup = { electronExited: false, httpClosed: false };
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    app = await _electron.launch({ executablePath: manifest.electron.executablePath, args: [path.join(here, 'electron-app')], env, timeout: 30_000 });
    child = app.process();
    const exit = once(child, 'exit');
    const page = await app.firstWindow();
    const versions = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, executablePath: process.execPath, platform: process.platform, arch: process.arch }));
    assert.equal(versions.electron, manifest.electron.version, 'VERSION_MISMATCH: Electron');
    assert.equal(versions.chromium, manifest.electron.chromium.version, 'VERSION_MISMATCH: Chromium');
    assert.equal(await realpath(versions.executablePath), await realpath(manifest.electron.executablePath), 'EXECUTABLE_MISMATCH: Electron');
    assert.equal(versions.platform, manifest.platform, 'PLATFORM_MISMATCH: Electron');
    assert.equal(versions.arch, manifest.arch, 'PLATFORM_MISMATCH: Electron');
    await page.goto(url, { timeout: 15_000 });
    assert.equal(page.url(), url);
    if (options.injectFailure) await page.locator('#missing-baseline-target').click({ timeout: 1000 });
    await page.getByRole('button', { name: 'Click baseline' }).click();
    const buttonResult = await page.locator('#result').textContent();
    assert.equal(buttonResult, 'clicked');
    await page.getByLabel('Baseline input').fill('ActionDriver baseline');
    const inputValue = await page.getByLabel('Baseline input').inputValue();
    assert.equal(inputValue, 'ActionDriver baseline');
    const screenshot = await page.screenshot({ path: path.join(outputDir, 'baseline.png') });
    const imageSize = await app.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
      if (image.isEmpty()) throw new Error('SCREENSHOT_EMPTY');
      return image.getSize();
    }, screenshot.toString('base64'));
    assert.ok(imageSize.width > 0 && imageSize.height > 0);
    await page.close();
    await assert.rejects(page.getByRole('button', { name: 'Click baseline' }).click({ timeout: 1000 }), /closed/i);
    await timeout(exit, 10_000, 'ELECTRON_EXIT_TIMEOUT');
    cleanup.electronExited = true;
    result = { buttonResult, inputValue, imageSize, closedPageRejected: true, versions, screenshot: path.join(outputDir, 'baseline.png'), cleanup };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        await timeout(app.close(), 10_000, 'ELECTRON_CLEANUP_TIMEOUT');
      }
      if (child && child.exitCode === null && child.signalCode === null) {
        await timeout(once(child, 'exit'), 10_000, 'ELECTRON_CLEANUP_TIMEOUT');
      }
      cleanup.electronExited = Boolean(child && (child.exitCode !== null || child.signalCode !== null));
    } catch (error) {
      if (child) {
        child.kill('SIGKILL');
        if (child.exitCode === null && child.signalCode === null) await timeout(once(child, 'exit'), 5000, 'ELECTRON_KILL_TIMEOUT');
      }
      failure ??= error;
    } finally {
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      cleanup.httpClosed = !server.listening;
    }
  }
  if (failure) { failure.cleanup = cleanup; throw failure; }
  assert.deepEqual(cleanup, { electronExited: true, httpClosed: true });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(await readFile(path.join(here, 'manifest.json'), 'utf8'));
    console.log(JSON.stringify(await runSmoke(manifest), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
