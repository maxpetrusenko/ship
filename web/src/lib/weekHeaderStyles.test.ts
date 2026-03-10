import { describe, expect, it } from 'vitest';

import { getCurrentWeekLabelClass } from './weekHeaderStyles';

describe('getCurrentWeekLabelClass', () => {
  it('uses a contrast-safe pill style for the current week label', () => {
    const className = getCurrentWeekLabelClass(true);

    expect(className).toContain('bg-accent/20');
    expect(className).toContain('text-foreground');
    expect(className).toContain('rounded');
    expect(className).not.toContain('text-accent');
  });

  it('keeps the standard text style for non-current weeks', () => {
    expect(getCurrentWeekLabelClass(false)).toBe('text-foreground');
  });
});
