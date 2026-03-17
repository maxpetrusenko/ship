import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyGitHubSignature,
  extractIssueRefs,
} from '../routes/github-webhook.js';

// -------------------------------------------------------------------------
// verifyGitHubSignature
// -------------------------------------------------------------------------

describe('verifyGitHubSignature', () => {
  const secret = 'test-secret-key';
  const body = JSON.stringify({ action: 'push' });

  function sign(payload: string, key: string): string {
    return 'sha256=' + crypto.createHmac('sha256', key).update(payload).digest('hex');
  }

  it('accepts a valid signature', () => {
    const sig = sign(body, secret);
    expect(verifyGitHubSignature(body, sig, secret)).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifyGitHubSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects an invalid signature', () => {
    expect(verifyGitHubSignature(body, 'sha256=invalid', secret)).toBe(false);
  });

  it('rejects a signature with wrong secret', () => {
    const sig = sign(body, 'wrong-secret');
    expect(verifyGitHubSignature(body, sig, secret)).toBe(false);
  });

  it('accepts Buffer input', () => {
    const buf = Buffer.from(body);
    const sig = sign(body, secret);
    expect(verifyGitHubSignature(buf, sig, secret)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// extractIssueRefs
// -------------------------------------------------------------------------

describe('extractIssueRefs', () => {
  it('extracts #123 ticket numbers', () => {
    const refs = extractIssueRefs('fix #42 and close #99');
    expect(refs.ticketNumbers).toContain(42);
    expect(refs.ticketNumbers).toContain(99);
    expect(refs.uuids).toHaveLength(0);
  });

  it('extracts SHP-456 prefixed refs', () => {
    const refs = extractIssueRefs('relates to SHP-456 and shp-789');
    expect(refs.ticketNumbers).toContain(456);
    expect(refs.ticketNumbers).toContain(789);
  });

  it('extracts UUIDs', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const refs = extractIssueRefs(`updating issue ${uuid}`);
    expect(refs.uuids).toContain(uuid);
    expect(refs.ticketNumbers).toHaveLength(0);
  });

  it('deduplicates references', () => {
    const refs = extractIssueRefs('fix #42, also #42, SHP-42');
    expect(refs.ticketNumbers).toEqual([42]);
  });

  it('handles empty text', () => {
    const refs = extractIssueRefs('');
    expect(refs.ticketNumbers).toHaveLength(0);
    expect(refs.uuids).toHaveLength(0);
  });

  it('handles text with no refs', () => {
    const refs = extractIssueRefs('just a regular commit message');
    expect(refs.ticketNumbers).toHaveLength(0);
    expect(refs.uuids).toHaveLength(0);
  });

  it('extracts mixed refs', () => {
    const uuid = 'deadbeef-1234-5678-9abc-def012345678';
    const refs = extractIssueRefs(`fix #10, SHP-20, and ${uuid}`);
    expect(refs.ticketNumbers).toContain(10);
    expect(refs.ticketNumbers).toContain(20);
    expect(refs.uuids).toContain(uuid);
  });
});
