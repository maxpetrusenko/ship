import { type ReactNode, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { cn } from '@/lib/cn';

export interface EntityBadge {
  text: string;
  color?: string | null;
}

export interface EntityGroup<T> {
  key: string;
  label?: string | null;
  items: T[];
  badge?: EntityBadge | null;
}

export interface EntityComboboxProps<T> {
  items: T[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  placeholder?: string;
  triggerClassName?: string;
  searchPlaceholder: string;
  emptyMessage: string;
  clearLabel?: string;
  popupClassName?: string;
  getKey: (item: T) => string;
  getValue: (item: T) => string;
  getLabel: (item: T) => string;
  getDescription?: (item: T) => string | null;
  getSearchTokens?: (item: T) => string[];
  getBadge?: (item: T) => EntityBadge | null;
  groups?: EntityGroup<T>[];
  onNavigate?: (item: T) => void;
  changeAriaLabel?: string;
  leadingAction?: {
    visible: boolean;
    render: () => ReactNode;
    onSelect: () => void;
  };
}

export function EntityCombobox<T>({
  items,
  value,
  onChange,
  disabled = false,
  ariaLabel: explicitAriaLabel,
  ariaLabelledBy: explicitAriaLabelledBy,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  placeholder = 'Select item...',
  triggerClassName,
  searchPlaceholder,
  emptyMessage,
  clearLabel,
  popupClassName,
  getKey,
  getValue,
  getLabel,
  getDescription,
  getSearchTokens,
  getBadge,
  groups,
  onNavigate,
  changeAriaLabel = 'Change selection',
  leadingAction,
}: EntityComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const resolvedAriaLabel = explicitAriaLabel ?? ariaLabel;
  const resolvedAriaLabelledBy = explicitAriaLabelledBy ?? ariaLabelledBy;

  const itemMap = useMemo(() => {
    return new Map(items.map((item) => [getKey(item), item]));
  }, [items, getKey]);

  const selectedItem = value
    ? items.find((item) => getValue(item) === value) ?? null
    : null;

  const normalizedGroups = groups ?? [{ key: '__all__', items }];

  const handleSelect = (nextValue: string | null) => {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  };

  const renderBadge = (badge: EntityBadge | null | undefined) => {
    if (!badge) return null;

    return (
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold text-white whitespace-nowrap"
        style={{ backgroundColor: badge.color || '#6b7280' }}
      >
        {badge.text}
      </span>
    );
  };

  const renderSelectedContent = (item: T) => (
    <>
      {renderBadge(getBadge?.(item))}
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{getLabel(item)}</div>
        {getDescription?.(item) && (
          <div className="truncate text-xs text-muted">{getDescription(item)}</div>
        )}
      </div>
    </>
  );

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <div
        className={cn(
          'group flex items-center rounded transition-colors overflow-hidden',
          'hover:bg-border/30',
          disabled && 'pointer-events-none opacity-50',
          triggerClassName,
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {selectedItem && onNavigate ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onNavigate(selectedItem);
              }}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-sm overflow-hidden',
                'focus:outline-none cursor-pointer hover:underline',
              )}
              title={getLabel(selectedItem)}
            >
              {renderSelectedContent(selectedItem)}
            </button>

            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-full shrink-0 items-center px-2 transition-opacity',
                  'hover:bg-border/50 rounded-r focus:outline-none',
                  isHovered ? 'opacity-100' : 'opacity-0',
                )}
                aria-label={changeAriaLabel}
              >
                <ChevronIcon className="h-3 w-3 text-muted" />
              </button>
            </Popover.Trigger>
          </>
        ) : (
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm',
                'hover:bg-border/30 transition-colors',
                'focus:outline-none focus:ring-1 focus:ring-accent',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
              aria-label={resolvedAriaLabel}
              aria-labelledby={resolvedAriaLabelledBy}
            >
              {selectedItem ? (
                renderSelectedContent(selectedItem)
              ) : (
                <span className="truncate text-muted">{placeholder}</span>
              )}
              <ChevronIcon className="ml-auto h-3 w-3 shrink-0 text-muted" />
            </button>
          </Popover.Trigger>
        )}
      </div>

      <Popover.Portal>
        <Popover.Content
          className={cn(
            'z-50 rounded-md border border-border bg-background shadow-lg',
            popupClassName || 'w-[220px]',
          )}
          sideOffset={4}
          align="start"
        >
          <Command
            className="flex flex-col"
            filter={(optionValue, query) => {
              const item = itemMap.get(optionValue);
              if (!item) return 0;
              const haystack = (getSearchTokens?.(item) ?? [
                getLabel(item),
                getDescription?.(item) || '',
              ]).join(' ').toLowerCase();
              return haystack.includes(query.toLowerCase()) ? 1 : 0;
            }}
          >
            {leadingAction?.visible && (
              <button
                type="button"
                onClick={() => {
                  leadingAction.onSelect();
                  setOpen(false);
                  setSearch('');
                }}
                className="text-left"
              >
                {leadingAction.render()}
              </button>
            )}

            <div className="border-b border-border p-2">
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
              />
            </div>

            <Command.List className="max-h-[300px] overflow-auto p-1">
              <Command.Empty className="px-2 py-4 text-center text-sm text-muted">
                {emptyMessage}
              </Command.Empty>

              {clearLabel && value && (
                <Command.Item
                  value="__clear__"
                  onSelect={() => handleSelect(null)}
                  className={cn(
                    'flex cursor-pointer items-center rounded px-2 py-1.5 text-sm text-muted',
                    'data-[selected=true]:bg-border/50 data-[selected=true]:text-foreground',
                  )}
                >
                  {clearLabel}
                </Command.Item>
              )}

              {normalizedGroups.map((group) => (
                <Command.Group key={group.key} heading="">
                  {group.label && (
                    <div className="mt-1 flex items-center gap-2 border-t border-border/50 px-2 py-1.5 text-xs font-semibold text-muted first:mt-0 first:border-t-0">
                      {renderBadge(group.badge)}
                      <span className="truncate">{group.label}</span>
                    </div>
                  )}

                  {group.items.map((item) => {
                    const itemValue = getValue(item);
                    const itemKey = getKey(item);
                    const description = getDescription?.(item);

                    return (
                      <Command.Item
                        key={itemKey}
                        value={itemKey}
                        onSelect={() => handleSelect(itemValue)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                          'data-[selected=true]:bg-border/50',
                          value === itemValue && 'text-accent',
                          group.label && 'pl-4',
                        )}
                      >
                        {renderBadge(getBadge?.(item))}
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{getLabel(item)}</div>
                          {description && (
                            <div className="truncate text-xs text-muted">{description}</div>
                          )}
                        </div>
                        {value === itemValue && (
                          <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-accent" />
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
