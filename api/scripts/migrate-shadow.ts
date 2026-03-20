/**
 * Shadow Database Migration Script
 *
 * Runs migrations on the shadow database without SSM loading.
 * Designed to work with port-forwarded connections.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx api/scripts/migrate-shadow.ts
 */

import pg from 'pg';
import { ensureDatabaseSchema } from '../src/db/bootstrap.js';
const { Pool } = pg;

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('Connecting to shadow database...');
  console.log('Host from URL:', databaseUrl.split('@')[1]?.split(':')[0]);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running database migrations...');
    const appliedNow = await ensureDatabaseSchema(pool, console);
    if (appliedNow.length === 0) {
      console.log('✅ All migrations already applied');
    } else {
      console.log(`✅ ${appliedNow.length} migration(s) applied successfully`);
    }

    // Verify test user
    const userResult = await pool.query(
      `SELECT id, email, name,
              CASE WHEN password_hash IS NOT NULL THEN 'SET' ELSE 'NULL' END as password_status
       FROM users WHERE LOWER(email) = LOWER('shawn.jones@treasury.gov')`
    );

    if (userResult.rows.length > 0) {
      console.log('\n✅ Test user verified:', userResult.rows[0]);
    } else {
      console.log('\n⚠️  Test user not found');
    }

  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
