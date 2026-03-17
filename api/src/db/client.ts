import pg from 'pg';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEnvFiles } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables before creating pool
loadEnvFiles(join(__dirname, '../..'));

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Production-ready pool configuration
  max: isProduction ? 20 : 10, // Max connections (default is 10)
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2 seconds
  maxUses: 7500, // Recycle connections after 7500 queries to prevent memory leaks
  // DDoS protection: Terminate queries running longer than 30 seconds
  statement_timeout: 30000, // 30 seconds max query duration
});

// Graceful shutdown - close pool connections on process termination
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database pool...');
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

export { pool };
