import { EntityCombobox, type EntityBadge } from './EntityCombobox';

export interface Person {
  id: string;
  user_id: string;
  name: string;
  email: string;
}

interface PersonComboboxProps {
  people: Person[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  'aria-label'?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getBadge(person: Person): EntityBadge {
  return {
    text: getInitials(person.name),
    color: '#0f766e',
  };
}

export function PersonCombobox({
  people,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select person...',
  className,
  ariaLabel,
  'aria-label': legacyAriaLabel,
}: PersonComboboxProps) {
  return (
    <EntityCombobox
      items={people}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel ?? legacyAriaLabel}
      placeholder={placeholder}
      triggerClassName={className}
      searchPlaceholder="Search people..."
      emptyMessage="No people found"
      clearLabel="Unassigned"
      getKey={(person) => person.user_id}
      getValue={(person) => person.user_id}
      getLabel={(person) => person.name}
      getDescription={(person) => person.email}
      getSearchTokens={(person) => [person.name, person.email]}
      getBadge={getBadge}
    />
  );
}
