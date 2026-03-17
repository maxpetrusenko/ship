import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFiles } from './env.js';

const TEST_KEY = 'FLEETGRAPH_ENV_ORDER_TEST';
const originalValue = process.env[TEST_KEY];

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[TEST_KEY];
  } else {
    process.env[TEST_KEY] = originalValue;
  }
});

describe('loadEnvFiles', () => {
  it('loads .env.hostinger and preserves precedence over .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-env-'));
    try {
      writeFileSync(join(dir, '.env'), `${TEST_KEY}=from-dotenv\n`);
      writeFileSync(join(dir, '.env.hostinger'), `${TEST_KEY}=from-hostinger\n`);
      writeFileSync(join(dir, '.env.local'), `${TEST_KEY}=from-local\n`);

      delete process.env[TEST_KEY];
      loadEnvFiles(dir);

      expect(process.env[TEST_KEY]).toBe('from-local');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses .env.hostinger when .env.local is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-env-'));
    try {
      writeFileSync(join(dir, '.env'), `${TEST_KEY}=from-dotenv\n`);
      writeFileSync(join(dir, '.env.hostinger'), `${TEST_KEY}=from-hostinger\n`);

      delete process.env[TEST_KEY];
      loadEnvFiles(dir);

      expect(process.env[TEST_KEY]).toBe('from-hostinger');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to parent env files when api-local env omits a key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-env-'));
    const apiDir = join(dir, 'api');
    try {
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(join(dir, '.env.hostinger'), `${TEST_KEY}=from-parent-hostinger\n`);
      writeFileSync(join(apiDir, '.env.local'), 'OTHER_KEY=present\n', { flag: 'w' });

      delete process.env[TEST_KEY];
      loadEnvFiles(apiDir);

      expect(process.env[TEST_KEY]).toBe('from-parent-hostinger');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
