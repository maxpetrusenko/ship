import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FleetGraphScope } from './useFleetGraphScope';

const mockUseLocation = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useLocation: () => mockUseLocation(),
  };
});

import { useFleetGraphPageContext } from './useFleetGraphPageContext';

describe('useFleetGraphPageContext', () => {
  const projectScope: FleetGraphScope = {
    scopeType: 'project',
    scopeId: 'proj-1',
    scopeLabel: 'Infrastructure - Bug Fixes',
  };

  beforeEach(() => {
    mockUseLocation.mockReturnValue({ pathname: '/documents/proj-1/details' });
  });

  it('marks the project details route as the Details tab', () => {
    const { result } = renderHook(() => useFleetGraphPageContext(projectScope));

    expect(result.current).toMatchObject({
      route: '/documents/proj-1/details',
      surface: 'project',
      documentId: 'proj-1',
      title: 'Infrastructure - Bug Fixes',
      tab: 'details',
      tabLabel: 'Details',
    });
  });

  it('treats the base project route as the default Details tab', () => {
    mockUseLocation.mockReturnValue({ pathname: '/documents/proj-1' });

    const { result } = renderHook(() => useFleetGraphPageContext(projectScope));

    expect(result.current).toMatchObject({
      route: '/documents/proj-1',
      tab: 'details',
      tabLabel: 'Details',
    });
  });
});
