#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${HOSTINGER_HOST:-ubuntu@187.77.7.226}"
SSH_KEY="${HOSTINGER_SSH_KEY:-$HOME/.ssh/hostinger_agent}"
REMOTE_DIR="${HOSTINGER_APP_DIR:-/opt/ship}"
ENV_FILE="${HOSTINGER_ENV_FILE:-$PROJECT_ROOT/.env.hostinger}"
SEED_DEMO_DATA="${HOSTINGER_SEED_DEMO_DATA:-1}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Copy .env.hostinger.example to .env.hostinger and fill secrets first."
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required"
  exit 1
fi

echo "Preparing remote directory..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" "sudo mkdir -p '$REMOTE_DIR' && sudo chown -R ubuntu:ubuntu '$REMOTE_DIR'"

echo "Syncing project..."
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude '.env.local' \
  --exclude 'api/.env.local' \
  --exclude 'web/.env' \
  --exclude 'coverage' \
  --exclude 'dist' \
  --exclude '*.zip' \
  "$PROJECT_ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"

echo "Uploading runtime env..."
scp -i "$SSH_KEY" "$ENV_FILE" "$REMOTE_HOST:$REMOTE_DIR/.env.hostinger"

echo "Deploying services..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" "cd '$REMOTE_DIR' && sudo docker compose --env-file .env.hostinger -f docker-compose.hostinger.yml up -d --build"

if [ "$SEED_DEMO_DATA" = "1" ]; then
  echo "Seeding demo data..."
  ssh -i "$SSH_KEY" "$REMOTE_HOST" "cd '$REMOTE_DIR' && sudo docker compose --env-file .env.hostinger -f docker-compose.hostinger.yml exec -T api node dist/db/seed.js"
fi

echo "Deployment complete"
