import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectableList, UseSelectionReturn } from './SelectableList';

interface TestItem {
  id: string;
  name: string;
}

const ITEMS: TestItem[] = [
  { id: 'one', name: 'One' },
  { id: 'two', name: 'Two' },
];

describe('SelectableList', () => {
  it('reports the right-clicked row as selected to the context-menu callback', () => {
    const onContextMenu = vi.fn<
      (event: React.MouseEvent, item: TestItem, selection: UseSelectionReturn) => void
    >();

    render(
      <SelectableList
        items={ITEMS}
        onContextMenu={onContextMenu}
        renderRow={(item) => <td role="gridcell">{item.name}</td>}
        ariaLabel="Test list"
      />
    );

    const row = screen.getByText('Two').closest('tr');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!);

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [, item, selection] = onContextMenu.mock.calls[0];
    expect(item.id).toBe('two');
    expect(Array.from(selection.selectedIds)).toEqual(['two']);
    expect(selection.selectedCount).toBe(1);
    expect(selection.isSelected('two')).toBe(true);
  });
});
