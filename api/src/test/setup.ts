process.env.NODE_ENV = 'test'

const [{ pool }, { ensureDatabaseSchema }] = await Promise.all([
  import('../db/client.js'),
  import('../db/bootstrap.js'),
]);

await ensureDatabaseSchema(pool);
