import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyReleasePatch, build, sha256 } from './build.mjs';

const manifest = JSON.parse(await readFile(new URL('../patches/manifest.json', import.meta.url), 'utf8'));
const patch = await readFile(new URL('../patches/lark-channel-bridge-0.7.0.patch', import.meta.url), 'utf8');
const upstreamDir = dirname(fileURLToPath(import.meta.resolve('lark-channel-bridge')));
const pristine = await readFile(join(upstreamDir, 'cli.js'), 'utf8');

test('release rebuilds reproducibly from exactly the pinned pristine package', async () => {
  const first = applyReleasePatch(pristine, patch, manifest);
  const second = applyReleasePatch(pristine, patch, manifest);
  assert.equal(first, second);
  assert.equal(sha256(first), manifest.targetCliSha256);
  assert.equal(await readFile(new URL('../dist/cli.js', import.meta.url), 'utf8'), first);
  const result = await build({ checkOnly: true });
  assert.equal(result.generated, false);
  for (const hook of ['tryHandleLocalFileOpen', 'startMessageRecallMonitor', 'im.message.recalled_v1', 'CheckMark', 'getFeishuWiki', 'tryHandleSocialLinkCollection']) assert.ok(first.includes(hook), hook);
  assert.doesNotMatch(first, /\/Users\/[^/\s]+\/|\/opt\/homebrew\/lib\/node_modules/);
  assert.match(first, /var SERVICE_NAME = "feishu-codex-obsidian-bridge\.bot";/);
  assert.doesNotMatch(first, /var SERVICE_NAME = "lark-channel-bridge\.bot";/);
});

test('unknown baseline, altered patch and altered target all fail closed', () => {
  assert.throws(() => applyReleasePatch(pristine + '\n', patch, manifest), /Upstream CLI checksum/);
  assert.throws(() => applyReleasePatch(pristine, patch + '\n', manifest), /patch checksum/);
  assert.throws(() => applyReleasePatch(pristine, patch, { ...manifest, targetCliSha256: '0'.repeat(64) }), /generated CLI checksum/);
});
