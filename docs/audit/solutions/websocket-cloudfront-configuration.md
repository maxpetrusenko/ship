# WebSocket Configuration with CloudFront

## Problem

WebSocket connections fail with 500 errors when going through CloudFront if the WebSocket endpoint path is not explicitly configured as a cache behavior.

**Symptoms:**
- Console shows: `WebSocket connection to 'wss://yourdomain.com/events' failed`
- Repeated `[RealtimeEvents] Error` and `[RealtimeEvents] Disconnected` messages
- Works locally but fails in production

## Root Cause

CloudFront DOES support WebSocket connections, but:
1. WebSocket endpoints need an explicit `ordered_cache_behavior` that routes to the API origin
2. Without explicit routing, the path falls through to the default S3 behavior (which returns 404/403)
3. CloudFront does NOT automatically detect and forward WebSocket upgrade requests

## Solution

Add a cache behavior for each WebSocket endpoint in `terraform/s3-cloudfront.tf`:

```hcl
# WebSocket endpoint - REQUIRED for real-time features
dynamic "ordered_cache_behavior" {
  for_each = var.eb_environment_cname != "" ? [1] : []
  content {
    path_pattern           = "/events"  # Your WebSocket path
    target_origin_id       = "EB-API"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false       # Disable compression for WebSocket
    min_ttl                = 0
    default_ttl            = 0           # No caching for real-time
    max_ttl                = 0

    forwarded_values {
      query_string = true
      headers      = ["*"]               # Forward ALL headers (critical for upgrade)
      cookies {
        forward = "all"
      }
    }
  }
}
```

## Critical Settings

1. **`headers = ["*"]`** - MUST forward all headers including:
   - `Upgrade: websocket`
   - `Connection: Upgrade`
   - `Sec-WebSocket-*` headers

2. **`compress = false`** - WebSocket frames shouldn't be compressed by CloudFront

3. **`default_ttl = 0`** - No caching for real-time connections

4. **`allowed_methods`** - Include all methods for WebSocket upgrade

## WebSocket Endpoints in Ship

| Path | Purpose | Handler |
|------|---------|---------|
| `/collaboration/*` | TipTap editor sync | `api/src/collaboration/index.ts` |
| `/events` | Real-time updates (accountability) | `api/src/collaboration/index.ts:690` |

## Debugging

### Test if CloudFront is routing correctly
```bash
# Should return 404 (expected - WebSocket upgrade required)
curl -s https://yourdomain.com/events

# Check headers
curl -sI https://yourdomain.com/events
```

### Test direct to EB (HTTP)
```bash
curl -s http://your-eb-cname.elasticbeanstalk.com/events
# Returns 404 - OK, WebSocket upgrade needed
```

### Browser DevTools
1. Open Network tab
2. Filter by WS
3. Look for 101 Switching Protocols (success) or error codes

## Fallback: Direct EB Connection

If CloudFront WebSocket doesn't work, use `VITE_WS_URL` to bypass CloudFront:

```typescript
// web/src/hooks/useRealtimeEvents.tsx
function getEventsWsUrl(): string {
  // VITE_WS_URL bypasses CloudFront for WebSocket
  const wsUrl = import.meta.env.VITE_WS_URL;
  if (wsUrl) {
    return wsUrl.replace(/^http/, 'ws') + '/events';
  }
  // ... default logic
}
```

Set in deploy script:
```bash
export VITE_WS_URL="https://your-eb-endpoint"
pnpm build:web
```

**Note:** This requires HTTPS on the EB ALB (ACM certificate).

## Related Files

- `terraform/s3-cloudfront.tf` - CloudFront cache behaviors
- `api/src/collaboration/index.ts` - WebSocket server implementation
- `web/src/hooks/useRealtimeEvents.tsx` - Frontend WebSocket client
