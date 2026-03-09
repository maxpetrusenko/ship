import { describe, expect, it } from 'vitest';
import { stringToPresenceColor } from './presenceColors';

describe('stringToPresenceColor', () => {
  it('returns a deterministic hex color for the same user name', () => {
    // Risk mitigated: collaborator cursors should keep a stable color between reconnects.
    expect(stringToPresenceColor('Max')).toBe(stringToPresenceColor('Max'));
  });

  it('returns a browser-safe hex color instead of hsl syntax', () => {
    // Risk mitigated: unsupported color-format warnings should not flood the console during live collaboration.
    expect(stringToPresenceColor('Max')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
