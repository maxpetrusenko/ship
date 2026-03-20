import crypto from 'node:crypto';
import type { FleetGraphEntityType } from '@ship/shared';
import type { ShipIssueSummary, ShipProject, ShipSprint } from '../data/types.js';

interface SprintDigestInput {
  sprint: ShipSprint;
  issues?: ShipIssueSummary[];
  projectIds?: string[];
}

interface ProjectDigestInput {
  project: Pick<ShipProject, 'id' | 'title' | 'updated_at' | 'properties' | 'content'> | { id: string; title?: string | null };
  issues?: ShipIssueSummary[];
  sprintIds?: string[];
}

interface ProjectDigestFallbackInput {
  projectId: string;
  issues?: ShipIssueSummary[];
  sprintIds?: string[];
}

function stableValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function hashParts(parts: unknown[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.map(stableValue).join('|'))
    .digest('hex')
    .slice(0, 16);
}

function normalizeContributingSprints(sprintIds?: string[]): string[] {
  const normalized = [...new Set((sprintIds ?? []).filter(Boolean))].sort();
  return normalized.length > 1 ? normalized : [];
}

function getIssueRollupParts(issues: ShipIssueSummary[]): string[] {
  return [...issues]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((issue) => [
      issue.id,
      issue.title,
      issue.state,
      issue.priority,
      issue.assignee_id,
      issue.ticket_number,
      issue.updated_at,
      issue.belongs_to
        .filter((relation) => relation.type === 'project' || relation.type === 'sprint')
        .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
    ].map(stableValue).join(':'));
}

function isSprintDigestInput(entity: unknown): entity is SprintDigestInput {
  return Boolean(
    entity &&
      typeof entity === 'object' &&
      'sprint' in entity &&
      (entity as Record<string, unknown>).sprint &&
      typeof (entity as Record<string, unknown>).sprint === 'object',
  );
}

function isProjectDigestInput(entity: unknown): entity is ProjectDigestInput {
  return Boolean(
    entity &&
      typeof entity === 'object' &&
      'project' in entity &&
      (entity as Record<string, unknown>).project &&
      typeof (entity as Record<string, unknown>).project === 'object',
  );
}

function isProjectDigestFallbackInput(entity: unknown): entity is ProjectDigestFallbackInput {
  return Boolean(
    entity &&
      typeof entity === 'object' &&
      'projectId' in entity &&
      typeof (entity as Record<string, unknown>).projectId === 'string',
  );
}

export function computeFleetGraphEntityDigest(
  entityType: FleetGraphEntityType,
  entity: unknown,
): string {
  if (entityType === 'sprint') {
    const sprintInput = isSprintDigestInput(entity)
      ? entity
      : { sprint: entity as ShipSprint, issues: [] };
    const sprint = sprintInput.sprint;
    const parts = [
      sprint.id,
      sprint.title,
      sprint.updated_at,
      sprint.properties?.status,
      sprint.properties?.sprint_number,
      sprint.properties?.owner_id,
      sprint.properties?.accountable_id,
      ...((sprintInput.projectIds ?? []).slice().sort()),
      ...(sprintInput.issues ? getIssueRollupParts(sprintInput.issues) : []),
    ];

    return hashParts(parts);
  }

  if (entityType === 'project' && isProjectDigestInput(entity)) {
    const project = entity.project;
    const parts = [
      project.id,
      ...normalizeContributingSprints(entity.sprintIds),
      ...(entity.issues ? getIssueRollupParts(entity.issues) : []),
    ];

    return hashParts(parts);
  }

  if (entityType === 'project' && isProjectDigestFallbackInput(entity)) {
    const parts = [
      entity.projectId,
      ...normalizeContributingSprints(entity.sprintIds),
      ...(entity.issues ? getIssueRollupParts(entity.issues) : []),
    ];

    return hashParts(parts);
  }

  return hashParts([entity]);
}
