import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function sha256Tree(root) {
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, name + '/');
      else if (entry.isFile()) entries.push([name, await sha256(file)]);
      else if (entry.isSymbolicLink()) entries.push([name, 'symlink:' + await readlink(file)]);
      else throw new Error(`ARTIFACT_TREE_UNSUPPORTED: ${file}`);
    }
  }
  await visit(root);
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function verifySource(source) {
  const git = args => execFileSync('git', ['-C', source.sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), source.commit, 'SOURCE_MISMATCH: commit');
  assert.equal(git(['remote', 'get-url', 'origin']).replace(/\.git$/, ''), source.repo.replace(/\.git$/, ''), 'SOURCE_MISMATCH: origin');
}

async function checkFile(file, expected) {
  try {
    assert.equal(await sha256(file), expected, `CHECKSUM_MISMATCH: ${file}`);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`ARTIFACT_MISSING: ${file}`, { cause: error });
    throw error;
  }
}

export async function verifyManifest(m) {
  assert.equal(m.schemaVersion, 1, 'MANIFEST_VERSION_MISMATCH');
  assert.equal(m.platform, process.platform, 'PLATFORM_MISMATCH');
  assert.equal(m.arch, process.arch, 'PLATFORM_MISMATCH');
  for (const source of [m.playwright, m.electron, m.electron.chromium]) verifySource(source);
  const root = await realpath(m.playwright.sourceRoot);
  const modulePath = await realpath(m.playwright.modulePath);
  const relative = path.relative(root, modulePath);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'MODULE_OUTSIDE_CHECKOUT');
  await checkFile(modulePath, m.playwright.moduleSha256);
  await checkFile(m.electron.executablePath, m.electron.executableSha256);
  await checkFile(m.electron.buildArgsPath, m.electron.buildArgsSha256);
  assert.equal(await sha256Tree(path.dirname(modulePath)), m.playwright.runtimeSha256, 'ARTIFACT_TREE_MISMATCH: Playwright runtime');
  const appRoot = await realpath(m.electron.appRoot);
  const executable = await realpath(m.electron.executablePath);
  const executableRelative = path.relative(appRoot, executable);
  assert.ok(executableRelative && !executableRelative.startsWith(`..${path.sep}`) && executableRelative !== '..' && !path.isAbsolute(executableRelative), 'EXECUTABLE_OUTSIDE_APP');
  assert.equal(await sha256Tree(appRoot), m.electron.appSha256, 'ARTIFACT_TREE_MISMATCH: Electron app');
}
