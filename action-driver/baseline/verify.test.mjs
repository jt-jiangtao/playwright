import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const implementation = await import('./verify.mjs').catch(() => ({}));
const verify = async m => {
  assert.equal(typeof implementation.verifyManifest, 'function', 'manifest verifier must exist');
  return implementation.verifyManifest(m);
};
const hash = text => createHash('sha256').update(text).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'action-driver-baseline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = {};
  for (const [name, repo] of [['playwright', 'https://github.com/jt-jiangtao/playwright.git'], ['electron', 'https://github.com/jt-jiangtao/electron.git'], ['chromium', 'https://chromium.googlesource.com/chromium/src.git']]) {
    const dir = path.join(root, name);
    await mkdir(dir);
    const git = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init']); git(['remote', 'add', 'origin', repo]);
    await writeFile(path.join(dir, 'baseline'), 'source');
    git(['add', 'baseline']);
    git(['-c', 'user.name=Baseline Test', '-c', 'user.email=baseline@example.invalid', 'commit', '-m', 'test baseline']);
    repos[name] = { sourceRoot: dir, commit: git(['rev-parse', 'HEAD']), repo };
  }
  const modulePath = path.join(repos.playwright.sourceRoot, 'packages', 'playwright-core', 'index.js');
  await mkdir(path.dirname(modulePath), { recursive: true });
  await writeFile(modulePath, 'module');
  await mkdir(path.join(path.dirname(modulePath), 'lib'));
  await writeFile(path.join(path.dirname(modulePath), 'lib', 'runtime.js'), 'compiled runtime');
  const appRoot = path.join(root, 'Electron.app');
  await mkdir(appRoot);
  const executablePath = path.join(appRoot, 'electron-binary');
  await writeFile(executablePath, 'binary');
  await writeFile(path.join(appRoot, 'framework'), 'framework code');
  const buildArgsPath = path.join(root, 'args.gn');
  await writeFile(buildArgsPath, 'target_cpu="arm64"');
  return {
    schemaVersion: 1, platform: 'darwin', arch: 'arm64',
    playwright: { ...repos.playwright, version: '1.63.0', modulePath, moduleSha256: hash('module'), runtimeSha256: await implementation.sha256Tree?.(path.dirname(modulePath)) ?? hash('pending runtime tree') },
    electron: { ...repos.electron, version: '38.8.6', chromium: repos.chromium, executablePath, executableSha256: hash('binary'), appRoot, appSha256: await implementation.sha256Tree?.(appRoot) ?? hash('pending app tree'), buildArgsPath, buildArgsSha256: hash('target_cpu="arm64"') },
  };
}

test('accepts locked sources and matching artifacts', async t => { await verify(await fixture(t)); });
test('rejects missing Electron executable', async t => {
  const m = await fixture(t); m.electron.executablePath += '.missing';
  await assert.rejects(verify(m), /ARTIFACT_MISSING/);
});
test('rejects mismatched Electron checksum', async t => {
  const m = await fixture(t); m.electron.executableSha256 = '0'.repeat(64);
  await assert.rejects(verify(m), /CHECKSUM_MISMATCH/);
});
test('rejects source commit drift', async t => {
  const m = await fixture(t); m.playwright.commit = '0'.repeat(40);
  await assert.rejects(verify(m), /SOURCE_MISMATCH/);
});
test('rejects a module outside the locked checkout', async t => {
  const m = await fixture(t); m.playwright.modulePath = m.electron.executablePath;
  await assert.rejects(verify(m), /MODULE_OUTSIDE_CHECKOUT/);
});
test('rejects changed build arguments', async t => {
  const m = await fixture(t); await writeFile(m.electron.buildArgsPath, 'target_cpu="x64"');
  await assert.rejects(verify(m), /CHECKSUM_MISMATCH/);
});
test('rejects wrong repository origin', async t => {
  const m = await fixture(t);
  execFileSync('git', ['-C', m.electron.sourceRoot, 'remote', 'set-url', 'origin', 'https://github.com/electron/electron.git']);
  await assert.rejects(verify(m), /SOURCE_MISMATCH/);
});
test('rejects module symlink escaping checkout', async t => {
  const m = await fixture(t);
  const { symlink, unlink } = await import('node:fs/promises');
  await unlink(m.playwright.modulePath); await symlink(m.electron.executablePath, m.playwright.modulePath);
  await assert.rejects(verify(m), /MODULE_OUTSIDE_CHECKOUT/);
});
test('rejects an incompatible manifest platform', async t => {
  const m = await fixture(t); m.arch = 'x64';
  await assert.rejects(verify(m), /PLATFORM_MISMATCH/);
});

test('rejects changed compiled code with unchanged module entry', async t => {
  const m = await fixture(t);
  await writeFile(path.join(path.dirname(m.playwright.modulePath), 'lib', 'runtime.js'), 'tampered runtime');
  await assert.rejects(verify(m), /ARTIFACT_TREE_MISMATCH/);
});
test('rejects changed framework with unchanged Electron launcher', async t => {
  const m = await fixture(t);
  await writeFile(path.join(m.electron.appRoot, 'framework'), 'tampered framework');
  await assert.rejects(verify(m), /ARTIFACT_TREE_MISMATCH/);
});
