export function getDatabaseSslConfig(): false | { rejectUnauthorized: false } {
  if (process.env.DATABASE_SSL === 'false' || process.env.DATABASE_SSL === '0') {
    return false;
  }

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
}
