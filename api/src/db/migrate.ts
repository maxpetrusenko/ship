#!/usr/bin/env npx ts-node
import { Pool } from 'pg';
import { loadProductionSecrets } from '../config/ssm.js';
import { loadEnvFiles } from '../config/env.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureDatabaseSchema } from './bootstrap.js';
import { getDatabaseSslConfig } from './ssl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load local env files before reading DATABASE_URL
loadEnvFiles(join(__dirname, '../..'));

async function migrate() {
  await loadProductionSecrets();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
  });

  try {
    console.log('Running database migrations...');
    const appliedNow = await ensureDatabaseSchema(pool, console);

    if (appliedNow.length === 0) {
      console.log('✅ All migrations already applied');
    } else {
      console.log(`✅ ${appliedNow.length} migration(s) applied successfully`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Database migration failed:', errorMessage);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
