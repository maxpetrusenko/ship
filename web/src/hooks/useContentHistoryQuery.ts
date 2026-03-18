import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

type JsonPrimitive = string | number | boolean | null;

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonArray = JsonValue[];

type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface ContentHistoryEntry {
  id: number;
  old_content: JsonValue | null;
  new_content: JsonValue | null;
  created_at: string;
  changed_by: {
    id: string;
    name: string;
  } | null;
}

/**
 * Hook to fetch content version history for weekly_plan and weekly_retro documents
 */
export function useContentHistoryQuery(
  documentId: string | undefined,
  documentType: 'weekly_plan' | 'weekly_retro'
) {
  const endpoint =
    documentType === 'weekly_plan'
      ? `/api/weekly-plans/${documentId}/history`
      : `/api/weekly-retros/${documentId}/history`;

  return useQuery<ContentHistoryEntry[]>({
    queryKey: ['content-history', documentId, documentType],
    queryFn: async () => {
      const response = await apiGet(endpoint);
      if (!response.ok) {
        throw new Error('Failed to fetch content history');
      }
      return response.json();
    },
    enabled: !!documentId,
  });
}

export const contentHistoryKeys = {
  all: ['content-history'] as const,
  document: (documentId: string, documentType: string) =>
    ['content-history', documentId, documentType] as const,
};
