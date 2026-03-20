import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = join(__dirname, 'schema.sql');
const migrationsDir = join(__dirname, 'migrations');
const createSchemaMigrationsTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )
`;

type BootstrapLogger = Pick<Console, 'log' | 'error'>;
type MigrationPool = Pick<pg.Pool, 'query' | 'connect'>;

async function hasExistingSchema(pool: Pick<pg.Pool, 'query'>): Promise<boolean> {
  const result = await pool.query(
    `SELECT to_regclass('public.workspaces') IS NOT NULL AS has_schema`,
  );
  return result.rows[0]?.has_schema === true;
}

function isIgnorableSchemaError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  if (error.code === '23505') {
    const detail = 'detail' in error && typeof error.detail === 'string' ? error.detail : '';
    return detail.includes('(extname)=(pg_trgm)');
  }

  return error.message.includes('already exists');
}

export async function ensureDatabaseSchema(
  pool: MigrationPool,
  logger?: BootstrapLogger,
): Promise<string[]> {
  if (!(await hasExistingSchema(pool))) {
    const schema = readFileSync(schemaPath, 'utf-8');

    try {
      await pool.query(schema);
    } catch (error) {
      if (!isIgnorableSchemaError(error)) {
        throw error;
      }
      logger?.log('Schema already present, continuing with pending migrations');
    }
  } else {
    logger?.log('Existing schema detected, skipping full schema.sql replay');
  }

  await pool.query(createSchemaMigrationsTableSql);

  const appliedResult = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedMigrations = new Set(appliedResult.rows.map((row) => row.version as string));
  const migrationFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()
    : [];

  const appliedNow: string[] = [];

  for (const file of migrationFiles) {
    const version = file.replace(/\.sql$/, '');
    if (appliedMigrations.has(version)) {
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(migrationsDir, file), 'utf-8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      appliedNow.push(version);
      logger?.log(`Applied migration ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger?.error(`Migration failed: ${version}`);
      throw error;
    } finally {
      client.release();
    }
  }

  return appliedNow;
}
