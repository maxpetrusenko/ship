import { config } from 'dotenv';
import { dirname, join } from 'path';

const DEFAULT_ENV_FILES = ['.env.local', '.env.hostinger', '.env'] as const;

export function loadEnvFiles(baseDir: string): void {
  const searchDirs = [baseDir];
  const parentDir = dirname(baseDir);

  if (parentDir !== baseDir) {
    searchDirs.push(parentDir);
  }

  for (const dir of searchDirs) {
    for (const filename of DEFAULT_ENV_FILES) {
      config({ path: join(dir, filename) });
    }
  }
}
