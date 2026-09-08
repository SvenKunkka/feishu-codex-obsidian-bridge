#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Parse dotenv data, never execute it as shell code. A stable checkout's .env
// also works when an upstream daemon starts this entrypoint with another cwd.
try {
  const values = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(process.env, key)) process.env[key] = value;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Never implicitly reuse an existing global bridge's codex profile or secrets.
const { bridgeConfig } = await import('../runtime/config.mjs');
process.env.LARK_CHANNEL_HOME = bridgeConfig.larkChannelHome;
const cli = new URL('../dist/cli.js', import.meta.url);
try { await access(cli); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('Generated CLI is missing. Run npm ci && npm run build in this checkout first.');
  process.exit(1);
}
await import(cli.href);
