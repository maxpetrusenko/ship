import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';

const PRECHECK_IMAGE = 'alpine:3.20';

async function runPreflight() {
  console.log('[preflight] checking Docker availability...');
  execSync('docker info', { stdio: 'pipe' });
  console.log('[preflight] checking Testcontainers runtime...');
  const container = await new GenericContainer(PRECHECK_IMAGE)
    .withCommand(['sh', '-c', 'echo playwright-preflight-ok && sleep 1'])
    .start();

  try {
    console.log('[preflight] test container started successfully');
  } finally {
    await container.stop();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runPreflight().catch((error) => {
    console.error('[preflight] failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export default runPreflight;
