import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EntityCombobox } from './EntityCombobox';

interface TestEntity {
  id: string;
  value: string;
  name: string;
  color: string;
}

const ITEMS: TestEntity[] = [
  { id: 'one', value: 'alpha', name: 'Alpha', color: '#111111' },
  { id: 'two', value: 'beta', name: 'Beta', color: '#222222' },
];

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Element.prototype.scrollIntoView = vi.fn();
});

describe('EntityCombobox', () => {
  it('filters generic items and selects the chosen value', () => {
    const onChange = vi.fn();

    render(
      <EntityCombobox
        items={ITEMS}
        value={null}
        onChange={onChange}
        placeholder="Select entity..."
        searchPlaceholder="Search entities..."
        emptyMessage="No entities"
        getKey={(item) => item.id}
        getValue={(item) => item.value}
        getLabel={(item) => item.name}
        getBadge={(item) => ({ text: item.name[0], color: item.color })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /select entity/i }));
    fireEvent.change(screen.getByPlaceholderText('Search entities...'), {
      target: { value: 'bet' },
    });
    fireEvent.click(screen.getByText('Beta'));

    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('shows a clear action when a value is selected', () => {
    const onChange = vi.fn();

    render(
      <EntityCombobox
        items={ITEMS}
        value="alpha"
        onChange={onChange}
        placeholder="Select entity..."
        searchPlaceholder="Search entities..."
        emptyMessage="No entities"
        clearLabel="Clear selection"
        getKey={(item) => item.id}
        getValue={(item) => item.value}
        getLabel={(item) => item.name}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    fireEvent.click(screen.getByText('Clear selection'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uses an explicit aria-label for the trigger when provided', () => {
    const onChange = vi.fn();

    render(
      <EntityCombobox
        items={ITEMS}
        value={null}
        onChange={onChange}
        placeholder="Select entity..."
        searchPlaceholder="Search entities..."
        emptyMessage="No entities"
        ariaLabel="Owner"
        getKey={(item) => item.id}
        getValue={(item) => item.value}
        getLabel={(item) => item.name}
      />,
    );

    expect(screen.getByRole('button', { name: 'Owner' })).toBeInTheDocument();
  });
});
