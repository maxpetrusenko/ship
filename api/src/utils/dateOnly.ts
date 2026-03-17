export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

export function normalizeDateOnlyValue(value: Date | string | null | undefined, fallback = new Date()): Date {
  if (value instanceof Date) {
    return startOfUtcDay(value);
  }

  if (typeof value === 'string' && value) {
    return new Date(`${value}T00:00:00Z`);
  }

  return startOfUtcDay(fallback);
}
