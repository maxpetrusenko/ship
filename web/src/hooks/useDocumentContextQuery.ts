import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface BreadcrumbItem {
  id: string;
  title: string;
  type: string;
  ticket_number?: number;
}

export interface ContextDocument {
  id: string;
  title: string;
  document_type: string;
  ticket_number?: number;
  depth?: number;
  child_count?: number;
}

export interface BelongsToItem {
  type: 'project' | 'sprint' | 'program';
  id: string;
  title: string;
  document_type: string;
  color?: string;
}

export interface DocumentContext {
  current: ContextDocument & {
    program_id?: string;
    program_name?: string;
    program_color?: string;
  };
  ancestors: ContextDocument[];
  children: (ContextDocument & { child_count: number })[];
  belongs_to: BelongsToItem[];
  breadcrumbs: BreadcrumbItem[];
}

// Query keys
export const documentContextKeys = {
  all: ['documentContext'] as const,
  detail: (id: string) => [...documentContextKeys.all, id] as const,
};

// Fetch document context
async function fetchDocumentContext(id: string): Promise<DocumentContext> {
  const res = await apiGet(`/api/documents/${id}/context`);
  if (!res.ok) {
    const error = new Error('Failed to fetch document context') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Hook to get document context (ancestors + children + breadcrumbs)
export function useDocumentContextQuery(id: string | undefined) {
  return useQuery({
    queryKey: documentContextKeys.detail(id || ''),
    queryFn: () => fetchDocumentContext(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnMount: 'always',
    retry: (failureCount, error) => {
      if ((error as Error & { status?: number }).status === 404) return false;
      return failureCount < 3;
    },
  });
}
