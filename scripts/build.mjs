import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatch } from 'diff';

const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function applyReleasePatch(source, patch, manifest) {
  if (sha256(source) !== manifest.upstream.cliSha256) {
    throw new Error('Upstream CLI checksum mismatch. Only the pinned, unmodified lark-channel-bridge 0.7.0 is supported.');
  }
  if (sha256(patch) !== manifest.patchSha256) throw new Error('Release patch checksum mismatch.');
  const result = applyPatch(source, patch, { fuzzFactor: 0 });
  if (result === false || sha256(result) !== manifest.targetCliSha256) {
    throw new Error('Exact patch application failed or generated CLI checksum did not match.');
  }
  return result;
}

export async function build({ checkOnly = false } = {}) {
  // A present node:sqlite module is not enough: older builds omit FTS5, which
  // the reviewed-knowledge index needs. Fail before producing a runnable CLI.
  let sqlite;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE VIRTUAL TABLE build_probe USING fts5(body)');
  } catch (cause) {
    throw new Error('This project requires Node.js with SQLite FTS5 (verified on Node 22.16.0+ and 24+). Upgrade Node.js before building.', { cause });
  } finally { sqlite?.close(); }
  const manifest = JSON.parse(await readFile(join(root, 'patches/manifest.json'), 'utf8'));
  // Resolve the checkout-local dependency, never npm's global installation.
  const upstreamEntry = fileURLToPath(import.meta.resolve('lark-channel-bridge'));
  const upstreamDir = dirname(upstreamEntry);
  const upstreamPackage = JSON.parse(await readFile(join(upstreamDir, '../package.json'), 'utf8'));
  if (upstreamPackage.name !== manifest.upstream.package || upstreamPackage.version !== manifest.upstream.version) {
    throw new Error('Installed upstream package is not the pinned release. Run npm ci.');
  }
  const source = await readFile(join(upstreamDir, 'cli.js'), 'utf8');
  const patch = await readFile(join(root, 'patches/lark-channel-bridge-0.7.0.patch'), 'utf8');
  const result = applyReleasePatch(source, patch, manifest);
  const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: result, encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(`Generated CLI failed syntax validation: ${syntax.stderr}`);
  if (!checkOnly) {
    const output = join(root, 'dist/cli.js');
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, result, { flag: 'wx' });
      await rename(temporary, output);
    } finally { await rm(temporary, { force: true }); }
  }
  return { checked: true, generated: !checkOnly, upstreamVersion: manifest.upstream.version, cliSha256: sha256(result) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await build({ checkOnly: process.argv.includes('--check') }), null, 2));
}
