import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEnvFiles } from './config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (.env.local takes precedence, then .env.hostinger, then .env)
loadEnvFiles(join(__dirname, '..'));

async function main() {
  // Load secrets from SSM in production (before importing app)
  if (process.env.NODE_ENV === 'production') {
    const { loadProductionSecrets } = await import('./config/ssm.js');
    await loadProductionSecrets();
  }

  // Now import app after secrets are loaded
  const { createApp } = await import('./app.js');
  const { setupCollaboration, broadcastToUser } = await import('./collaboration/index.js');

  const PORT = process.env.PORT || 3000;
  const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

  const app = createApp(CORS_ORIGIN);
  const server = createServer(app);

  // DDoS protection: Set server-wide timeouts to prevent slow-read attacks (Slowloris)
  server.timeout = 60000; // 60 seconds max request duration
  server.keepAliveTimeout = 65000; // 65 seconds (slightly longer than timeout)
  server.headersTimeout = 66000; // 66 seconds (slightly longer than keepAlive)

  // Setup WebSocket collaboration server
  setupCollaboration(server);

  // Start server
  server.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`CORS origin: ${CORS_ORIGIN}`);
  });

  // --- FleetGraph startup (non-critical) ---
  try {
    const { bootstrapFleetGraph } = await import('./fleetgraph/bootstrap.js');
    const { pool } = await import('./db/client.js');
    await bootstrapFleetGraph(pool, broadcastToUser);
  } catch (err) {
    console.warn('[FleetGraph] Disabled; server continues without it');
    console.error('[FleetGraph] Startup error:', err);
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
