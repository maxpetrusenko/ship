/**
 * FleetGraph chat access policy.
 * Centralized verification that the current user can access the requested chat scope.
 *
 * Current rules:
 * - Thread ownership: threads are scoped to (workspace_id, user_id)
 * - Entity access: defers to existing app auth (session + workspace membership)
 * - Extension point: future role-based narrowing (e.g., dev vs manager view)
 */
import type pg from 'pg';
import type { FleetGraphChatThread, FleetGraphEntityType } from '@ship/shared';
import { getThreadById } from './persistence.js';

export interface ChatAccessContext {
  userId: string;
  workspaceId: string;
}

/**
 * Verify thread access: the thread must belong to the same user + workspace.
 * Returns the thread if accessible, null if not found or access denied.
 */
export async function verifyThreadAccess(
  pool: pg.Pool,
  threadId: string,
  ctx: ChatAccessContext,
): Promise<FleetGraphChatThread | null> {
  return getThreadById(pool, threadId, ctx.workspaceId, ctx.userId);
}

/**
 * Verify entity access for a chat turn.
 * Currently defers to app-level auth (the user is already authenticated
 * and scoped to a workspace). This hook exists as an extension point
 * for future narrowing (e.g., private documents, role-based restrictions).
 *
 * Returns true if accessible.
 */
export function verifyEntityAccess(
  _entityType: FleetGraphEntityType,
  _entityId: string,
  _ctx: ChatAccessContext,
): boolean {
  // Currently all workspace members can access all entities.
  // Future: check document visibility, role restrictions, etc.
  return true;
}
