import { describe, expect, it } from 'vitest';
import { normalizeDateOnlyValue, startOfUtcDay } from '../dateOnly.ts';

describe('dateOnly utils', () => {
  it('preserves the UTC calendar day for pg DATE objects', () => {
    const pgDate = new Date('2025-01-06T00:00:00.000Z');

    expect(normalizeDateOnlyValue(pgDate).toISOString()).toBe('2025-01-06T00:00:00.000Z');
  });

  it('normalizes string dates to UTC midnight', () => {
    expect(normalizeDateOnlyValue('2025-01-06').toISOString()).toBe('2025-01-06T00:00:00.000Z');
  });

  it('builds UTC midnight for fallback dates', () => {
    const input = new Date('2025-01-06T18:45:00.000Z');

    expect(startOfUtcDay(input).toISOString()).toBe('2025-01-06T00:00:00.000Z');
  });
});
