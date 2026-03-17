import { useId, Children, isValidElement, cloneElement } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

interface PropertyRowProps {
  label: string;
  tooltip?: string;
  highlighted?: boolean;
  children: React.ReactNode;
}

/**
 * PropertyRow - Standard property field layout for document sidebars
 *
 * Supports optional tooltip and field highlighting (e.g., for missing required fields).
 * Generates a stable label id via useId() and injects aria-labelledby on direct child
 * elements for accessible label association (WCAG).
 */
export function PropertyRow({ label, tooltip, highlighted, children }: PropertyRowProps) {
  const labelId = useId();

  const labelledChildren = Children.map(children, (child) => {
    if (isValidElement(child)) {
      const existing = (child.props as Record<string, unknown>);
      // Skip if child already has an accessible label
      if (existing['aria-label'] || existing['aria-labelledby'] || existing['id']) {
        return child;
      }
      return cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        'aria-labelledby': labelId,
      });
    }
    return child;
  });

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label
          id={labelId}
          className={`text-xs font-medium ${highlighted ? 'text-amber-500' : 'text-muted'}`}
        >
          {label}
          {highlighted && <span className="ml-1 text-amber-500">*</span>}
        </label>
        {tooltip && (
          <Tooltip content={tooltip} side="right" delayDuration={200}>
            <button
              type="button"
              className="text-muted/60 hover:text-muted transition-colors"
              aria-label={`More info about ${label}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
      {labelledChildren}
    </div>
  );
}
