import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('launcher reads its own .env from another cwd, preserves existing env and never evaluates shell expressions', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'bridge-launcher-'));
  try {
    for (const dir of ['bin', 'runtime', 'dist', 'elsewhere']) await mkdir(join(fixture, dir));
    await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
    await writeFile(join(fixture, 'bin/bridge.mjs'), await readFile(new URL('../bin/feishu-codex-obsidian-bridge.mjs', import.meta.url)));
    await writeFile(join(fixture, '.env'), 'RELEASE_TEST_VALUE=from-file\nRELEASE_TEST_EXISTING=must-not-win\nRELEASE_TEST_LITERAL="$(echo not-executed)"\n');
    await writeFile(join(fixture, 'runtime/config.mjs'), `import {homedir} from 'node:os';import {join} from 'node:path';const given=process.env.LARK_CHANNEL_HOME;export const bridgeConfig = {larkChannelHome: given?.startsWith('~/') ? join(homedir(),given.slice(2)) : given || process.env.RELEASE_TEST_VALUE + '/isolated-channel'};`);
    await writeFile(join(fixture, 'dist/cli.js'), 'console.log(JSON.stringify({value:process.env.RELEASE_TEST_VALUE,existing:process.env.RELEASE_TEST_EXISTING,literal:process.env.RELEASE_TEST_LITERAL,home:process.env.LARK_CHANNEL_HOME}));');
    const env = { ...process.env, RELEASE_TEST_EXISTING: 'from-process' };
    delete env.RELEASE_TEST_VALUE; delete env.RELEASE_TEST_LITERAL; delete env.LARK_CHANNEL_HOME;
    const run = spawnSync(process.execPath, [join(fixture, 'bin/bridge.mjs')], { cwd: join(fixture, 'elsewhere'), env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { value: 'from-file', existing: 'from-process', literal: '$(echo not-executed)', home: 'from-file/isolated-channel' });
    const override = spawnSync(process.execPath, [join(fixture, 'bin/bridge.mjs')], { cwd: fixture, env: { ...env, LARK_CHANNEL_HOME: 'explicit-user-home' }, encoding: 'utf8' });
    assert.equal(override.status, 0, override.stderr);
    assert.equal(JSON.parse(override.stdout).home, 'explicit-user-home');
    const tilde = spawnSync(process.execPath, [join(fixture, 'bin/bridge.mjs')], { cwd: fixture, env: { ...env, HOME: fixture, LARK_CHANNEL_HOME: '~/isolated-profile' }, encoding: 'utf8' });
    assert.equal(tilde.status, 0, tilde.stderr);
    assert.equal(JSON.parse(tilde.stdout).home, join(fixture, 'isolated-profile'));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
