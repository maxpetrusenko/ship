-- API Tokens for CLI/external tool authentication
-- Tokens are long-lived (unlike sessions) and used for programmatic access

CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- User-provided name for the token (e.g., "Claude Code")
  token_hash TEXT NOT NULL,  -- SHA-256 hash of the token (never store plain token)
  token_prefix TEXT NOT NULL,  -- First 12 chars for identification (e.g., "ship_abc1234")
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,  -- NULL = never expires
  revoked_at TIMESTAMPTZ,  -- NULL = active, timestamp = revoked
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Only one active token per name per user per workspace
  UNIQUE(user_id, workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace_id ON api_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_prefix ON api_tokens(token_prefix);

-- Comment explaining the token format
COMMENT ON TABLE api_tokens IS 'API tokens for CLI/programmatic access. Token format: ship_{random_32_bytes_hex}. Only the hash is stored.';
