import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pool before importing the module
const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

import { transformIssueLinks } from '../utils/transformIssueLinks.js';

type TipTapNode = {
  type: string;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TipTapNode[];
};

type TipTapDoc = {
  type: 'doc';
  content: TipTapNode[];
};

function mockRows<Row extends object>(rows: Row[], rowCount = rows.length) {
  return { rows, rowCount };
}

function toDoc(value: unknown): TipTapDoc {
  return value as TipTapDoc;
}

function findTextNode(nodes: TipTapNode[] | undefined, text: string): TipTapNode | undefined {
  return nodes?.find((node) => node.text === text);
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }

  return value;
}

function requireContent(node: { content?: TipTapNode[] }, label: string): TipTapNode[] {
  return requireValue(node.content, label);
}

describe('transformIssueLinks', () => {
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pattern matching and transformation', () => {
    it('transforms #123 pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #42 for details' }],
          },
        ],
      };

      // Mock issue lookup
      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-42', ticket_number: 42 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const paragraphContent = requireContent(paragraph, 'first paragraph content');

      expect(paragraphContent).toHaveLength(3);
      expect(paragraphContent[0]).toEqual({ type: 'text', text: 'See ' });
      expect(paragraphContent[1]).toEqual({
        type: 'text',
        text: '#42',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-42',
              target: '_self',
            },
          },
        ],
      });
      expect(paragraphContent[2]).toEqual({ type: 'text', text: ' for details' });
    });

    it('transforms "issue #123" pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Fixed in issue #100' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-100', ticket_number: 100 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const paragraphContent = requireContent(paragraph, 'first paragraph content');

      expect(paragraphContent[1]).toEqual({
        type: 'text',
        text: 'issue #100',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-100',
              target: '_self',
            },
          },
        ],
      });
    });

    it('transforms "ISS-123" pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Related to ISS-500' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-500', ticket_number: 500 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const paragraphContent = requireContent(paragraph, 'first paragraph content');

      expect(paragraphContent[1]).toEqual({
        type: 'text',
        text: 'ISS-500',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-500',
              target: '_self',
            },
          },
        ],
      });
    });

    it('transforms multiple issue references in same text', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #10, #20, and issue #30' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([
          { id: 'issue-uuid-10', ticket_number: 10 },
          { id: 'issue-uuid-20', ticket_number: 20 },
          { id: 'issue-uuid-30', ticket_number: 30 },
        ]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      // Should split into multiple text nodes with links
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const nodes = requireContent(paragraph, 'first paragraph content');
      expect(findTextNode(nodes, '#10')?.marks).toBeDefined();
      expect(findTextNode(nodes, '#20')?.marks).toBeDefined();
      expect(findTextNode(nodes, 'issue #30')?.marks).toBeDefined();
    });

    it('queries database for all unique ticket numbers', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#1 and #2 and #3' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      await transformIssueLinks(content, workspaceId);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('ticket_number = ANY'),
        [workspaceId, expect.arrayContaining([1, 2, 3])]
      );
    });

    it('deduplicates ticket numbers in query', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#5 and #5 and #5' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      await transformIssueLinks(content, workspaceId);

      const queryArgs = mockPoolQuery.mock.calls[0]?.[1];
      expect(Array.isArray(queryArgs)).toBe(true);
      if (!Array.isArray(queryArgs)) {
        throw new Error('Expected query args array');
      }
      const ticketNumbers = queryArgs[1];

      // Should only query for #5 once despite appearing multiple times
      expect(ticketNumbers).toEqual([5]);
    });
  });

  describe('edge cases', () => {
    it('does not transform text that already has marks', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '#99 is already a link',
                marks: [{ type: 'link', attrs: { href: '/somewhere' } }],
              },
            ],
          },
        ],
      };

      // Mock database lookup (implementation still queries even for marked text)
      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-99', ticket_number: 99 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      // Should not transform already marked text
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const paragraphContent = requireContent(paragraph, 'first paragraph content');
      expect(paragraphContent[0]).toEqual({
        type: 'text',
        text: '#99 is already a link',
        marks: [{ type: 'link', attrs: { href: '/somewhere' } }],
      });

      // Note: Implementation does query database for ticket numbers,
      // but doesn't transform text that already has marks
      expect(mockPoolQuery).toHaveBeenCalled();
    });

    it('keeps issue reference as plain text when issue does not exist', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Non-existent #999' }],
          },
        ],
      };

      // No matching issues found
      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      // When no issues are found, content is returned unchanged
      // (implementation optimization - doesn't transform if issueMap is empty)
      expect(result).toEqual(content);
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const paragraphContent = requireContent(paragraph, 'first paragraph content');
      expect(paragraphContent[0]?.text).toBe('Non-existent #999');
      expect(paragraphContent[0]?.marks).toBeUndefined();
    });

    it('transforms existing issues but not non-existent ones', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #50 and #999' }],
          },
        ],
      };

      // Only #50 exists
      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-50', ticket_number: 50 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      const paragraph = requireValue(result.content[0], 'first paragraph');
      const nodes = requireContent(paragraph, 'first paragraph content');

      // #50 should have link mark
      const link50 = findTextNode(nodes, '#50');
      expect(link50?.marks).toBeDefined();

      // #999 should be plain text (no marks)
      const text999 = findTextNode(nodes, '#999');
      expect(text999?.marks).toBeUndefined();
    });

    it('returns unchanged content when no issue patterns found', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'No issue references here' }],
          },
        ],
      };

      const result = await transformIssueLinks(content, workspaceId);

      // Should not query database
      expect(mockPoolQuery).not.toHaveBeenCalled();

      // Should return unchanged
      expect(result).toEqual(content);
    });

    it('returns unchanged content for invalid input', async () => {
      expect(await transformIssueLinks(null, workspaceId)).toBeNull();
      expect(await transformIssueLinks(undefined, workspaceId)).toBeUndefined();
      expect(await transformIssueLinks('string', workspaceId)).toBe('string');
      expect(await transformIssueLinks(123, workspaceId)).toBe(123);
    });

    it('returns unchanged content when not a doc type', async () => {
      const content = {
        type: 'paragraph',
        content: [{ type: 'text', text: '#123' }],
      };

      const result = await transformIssueLinks(content, workspaceId);
      expect(result).toEqual(content);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('handles empty document content', async () => {
      const content = {
        type: 'doc',
        content: [],
      };

      const result = await transformIssueLinks(content, workspaceId);
      expect(result).toEqual(content);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  describe('nested content structures', () => {
    it('transforms issue links in nested paragraphs', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item with #25' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-25', ticket_number: 25 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      const list = requireValue(result.content[0], 'top-level list');
      const listItem = requireValue(requireContent(list, 'top-level list content')[0], 'list item');
      const paragraph = requireValue(requireContent(listItem, 'list item content')[0], 'nested paragraph');
      const link = findTextNode(requireContent(paragraph, 'nested paragraph content'), '#25');
      expect(link?.marks).toBeDefined();
      expect(link?.marks?.[0]?.attrs?.href).toBe('/issues/issue-uuid-25');
    });

    it('transforms issue links in blockquotes', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Quoted text with issue #77' }],
              },
            ],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([{ id: 'issue-uuid-77', ticket_number: 77 }]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      const blockquote = requireValue(result.content[0], 'blockquote');
      const paragraph = requireValue(requireContent(blockquote, 'blockquote content')[0], 'blockquote paragraph');
      const link = findTextNode(requireContent(paragraph, 'blockquote paragraph content'), 'issue #77');
      expect(link?.marks).toBeDefined();
    });

    it('recursively transforms all nested issue references', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Top level #1' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Nested #2' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([
          { id: 'issue-uuid-1', ticket_number: 1 },
          { id: 'issue-uuid-2', ticket_number: 2 },
        ]));

      await transformIssueLinks(content, workspaceId);

      // Should find both #1 and #2
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.anything(),
        [workspaceId, expect.arrayContaining([1, 2])]
      );
    });
  });

  describe('workspace isolation', () => {
    it('only looks up issues in the specified workspace', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#123' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      await transformIssueLinks(content, workspaceId);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('workspace_id = $1'),
        [workspaceId, [123]]
      );
    });

    it('does not transform issues from other workspaces', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#888' }],
          },
        ],
      };

      // Issue exists but in different workspace
      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      // Should remain plain text
      const paragraph = requireValue(result.content[0], 'first paragraph');
      const textNode = requireValue(requireContent(paragraph, 'first paragraph content')[0], 'plain text node');
      expect(textNode.marks).toBeUndefined();
    });
  });

  describe('case variations', () => {
    it('handles "issue #" with various casings', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Issue #5 and ISSUE #6' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([
          { id: 'issue-uuid-5', ticket_number: 5 },
          { id: 'issue-uuid-6', ticket_number: 6 },
        ]));

      const result = toDoc(await transformIssueLinks(content, workspaceId));

      const paragraph = requireValue(result.content[0], 'first paragraph');
      const nodes = requireContent(paragraph, 'first paragraph content');

      // Both should be transformed
      expect(findTextNode(nodes, 'Issue #5')?.marks).toBeDefined();
      expect(findTextNode(nodes, 'ISSUE #6')?.marks).toBeDefined();
    });
  });

  describe('performance considerations', () => {
    it('does not query database when no patterns detected', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Just normal text without issue refs' }],
          },
        ],
      };

      const result = await transformIssueLinks(content, workspaceId);

      // Should not query when no issue patterns found
      expect(mockPoolQuery).not.toHaveBeenCalled();

      // Should return unchanged content
      expect(result).toEqual(content);
    });

    it('makes single batch query for multiple issues', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#1 #2 #3 #4 #5' }],
          },
        ],
      };

      mockPoolQuery.mockResolvedValueOnce(mockRows([]));

      await transformIssueLinks(content, workspaceId);

      // Should make exactly one query for all issues
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });
  });
});
