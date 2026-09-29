#!/usr/bin/env bun
/**
 * Local launcher shared by Claude Code (`.mcp.json`) and Codex
 * (`.codex/config.toml`).
 *
 * Both clients start the same command from the repository root and neither
 * committed config holds a secret. This file reads the git-ignored root `.env`
 * for the handful of values the server needs, then hands over to the ordinary
 * stdio entry point. Values already present in the environment win, so a
 * client that injects its own configuration is never overridden.
 *
 * Only the keys below are loaded — the rest of `.env` (Convex, OpenAI and so
 * on) never reaches the MCP process.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEYS = [
  'HOME_MANAGEMENT_URL',
  'HOME_MANAGEMENT_ENVIRONMENT',
  'HOME_MANAGEMENT_TOKEN',
  // `upload_media` uploads straight to Uploadfile from this machine.
  'UPLOADFILE_TOKEN',
] as const;

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (!(KEYS as readonly string[]).includes(key) || process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

await import('./stdio.js');
