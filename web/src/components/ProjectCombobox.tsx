import { EntityCombobox, type EntityBadge, type EntityGroup } from './EntityCombobox';
import { cn } from '@/lib/cn';

export interface Project {
  id: string;
  title: string;
  color?: string | null;
  programId: string | null;
  programName: string | null;
  programEmoji?: string | null;
  programColor?: string | null;
}

interface ProjectComboboxProps {
  projects: Project[];
  value: string | null;
  onChange: (value: string | null) => void;
  onNavigate?: (projectId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  previousWeekProject?: Project | null;
  ariaLabel?: string;
  'aria-label'?: string;
}

function getProjectBadge(project: Project): EntityBadge {
  return {
    text: project.programEmoji || project.title[0] || '?',
    color: project.color || project.programColor || '#6b7280',
  };
}

function buildProjectGroups(projects: Project[]): EntityGroup<Project>[] {
  const groupedProjects = projects.reduce<Record<string, Project[]>>((acc, project) => {
    const key = project.programId || '__unassigned__';
    acc[key] ||= [];
    acc[key].push(project);
    return acc;
  }, {});

  return Object.keys(groupedProjects)
    .sort((left, right) => {
      if (left === '__unassigned__') return 1;
      if (right === '__unassigned__') return -1;
      const leftName = groupedProjects[left]?.[0]?.programName || '';
      const rightName = groupedProjects[right]?.[0]?.programName || '';
      return leftName.localeCompare(rightName);
    })
    .map((key) => {
      const groupProjects = groupedProjects[key] || [];
      const firstProject = groupProjects[0];
      const label = key === '__unassigned__'
        ? 'Not assigned to a program'
        : firstProject?.programName || 'Unknown';

      return {
        key,
        label,
        badge: {
          text: firstProject?.programEmoji || label[0] || '?',
          color: firstProject?.programColor || '#6b7280',
        },
        items: groupProjects,
      };
    });
}

export function ProjectCombobox({
  projects,
  value,
  onChange,
  onNavigate,
  disabled = false,
  placeholder = 'Select project...',
  triggerClassName,
  previousWeekProject,
  ariaLabel,
  'aria-label': legacyAriaLabel,
}: ProjectComboboxProps) {
  const validPreviousWeekProject = previousWeekProject
    ? projects.find((project) => project.id === previousWeekProject.id) ?? null
    : null;

  return (
    <EntityCombobox
      items={projects}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel ?? legacyAriaLabel}
      placeholder={placeholder}
      triggerClassName={triggerClassName}
      popupClassName="w-[260px]"
      searchPlaceholder="Search projects..."
      emptyMessage="No projects found"
      clearLabel="None"
      getKey={(project) => project.id}
      getValue={(project) => project.id}
      getLabel={(project) => project.title}
      getSearchTokens={(project) => [project.title, project.programName || '']}
      getBadge={getProjectBadge}
      groups={buildProjectGroups(projects)}
      onNavigate={onNavigate ? (project) => onNavigate(project.id) : undefined}
      changeAriaLabel="Change project assignment"
      leadingAction={validPreviousWeekProject ? {
        visible: true,
        onSelect: () => onChange(validPreviousWeekProject.id),
        render: () => (
          <div
            className={cn(
              'flex items-center gap-2 px-2 py-2 text-sm',
              'bg-accent/10 hover:bg-accent/20 border-b border-border transition-colors',
            )}
          >
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold text-white"
              style={{ backgroundColor: validPreviousWeekProject.programColor || '#6b7280' }}
            >
              {validPreviousWeekProject.programEmoji || validPreviousWeekProject.title[0] || '?'}
            </span>
            <span className="truncate">
              <span className="text-muted">Same as last week:</span>{' '}
              <span className="text-foreground">{validPreviousWeekProject.title}</span>
            </span>
          </div>
        ),
      } : undefined}
    />
  );
}
