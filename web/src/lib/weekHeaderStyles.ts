export function getCurrentWeekLabelClass(isCurrent: boolean): string {
  if (!isCurrent) {
    return 'text-foreground';
  }

  return 'rounded bg-accent/20 px-1.5 py-0.5 text-foreground';
}
