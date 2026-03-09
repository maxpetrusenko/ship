function toHexChannel(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function stringToPresenceColor(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }

  const normalized = Math.abs(hash);
  const red = 64 + (normalized & 0x3f);
  const green = 96 + ((normalized >> 6) & 0x5f);
  const blue = 112 + ((normalized >> 12) & 0x4f);

  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}
