import crypto from 'node:crypto';
import type { FleetGraphEntityType } from '@ship/shared';
import type { ShipSprint } from '../data/types.js';

function stableValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function computeFleetGraphEntityDigest(
  entityType: FleetGraphEntityType,
  entity: unknown,
): string {
  if (entityType === 'sprint') {
    const sprint = entity as ShipSprint;
    const parts = [
      sprint.id,
      sprint.title,
      sprint.updated_at,
      sprint.properties?.status,
      sprint.properties?.sprint_number,
      sprint.properties?.owner_id,
      sprint.properties?.accountable_id,
    ].map(stableValue);

    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  }

  return crypto
    .createHash('sha256')
    .update(stableValue(entity))
    .digest('hex')
    .slice(0, 16);
}
