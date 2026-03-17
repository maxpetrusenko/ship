import { EntityCombobox, type EntityBadge } from './EntityCombobox';

export interface Program {
  id: string;
  name: string;
  color: string;
  emoji?: string | null;
}

interface ProgramComboboxProps {
  programs: Program[];
  value: string | null;
  onChange: (value: string | null) => void;
  onNavigate?: (programId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  'aria-label'?: string;
}

function getBadge(program: Program): EntityBadge {
  return {
    text: program.emoji || program.name[0] || '?',
    color: program.color,
  };
}

export function ProgramCombobox({
  programs,
  value,
  onChange,
  onNavigate,
  disabled = false,
  placeholder = 'Select program...',
  triggerClassName,
  ariaLabel,
  'aria-label': legacyAriaLabel,
}: ProgramComboboxProps) {
  return (
    <EntityCombobox
      items={programs}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel ?? legacyAriaLabel}
      placeholder={placeholder}
      triggerClassName={triggerClassName}
      searchPlaceholder="Search programs..."
      emptyMessage="No programs found"
      clearLabel="None"
      getKey={(program) => program.id}
      getValue={(program) => program.id}
      getLabel={(program) => program.name}
      getSearchTokens={(program) => [program.name]}
      getBadge={getBadge}
      onNavigate={onNavigate ? (program) => onNavigate(program.id) : undefined}
      changeAriaLabel="Change program assignment"
    />
  );
}
