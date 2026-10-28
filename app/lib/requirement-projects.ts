export interface RequirementProject {
  id: string;
  name: string;
  sort?: number;
  archived?: boolean;
  parent_id?: string | null;
}

export interface ProjectOption {
  id: string;
  label: string;
  archived: boolean;
}

/** Paths describe visible ancestry only; selecting one ID never selects descendants. */
export function projectOptions(projects: readonly RequirementProject[]): ProjectOption[] {
  const byId = new Map(projects.map(p => [p.id, p]));
  const ordered = [...byId.values()].sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh'));
  const seen = new Set<string>();
  const out: ProjectOption[] = [];
  const visit = (project: RequirementProject, ancestors: string[]) => {
    if (seen.has(project.id)) return;
    seen.add(project.id);
    const path = [...ancestors, project.name];
    out.push({ id: project.id, label: path.join(' / '), archived: project.archived === true });
    for (const child of ordered) if (child.parent_id === project.id) visit(child, path);
  };
  for (const p of ordered) if (!p.parent_id || !byId.has(p.parent_id)) visit(p, []);
  // Malformed cycles must not hide a selectable project or recurse forever.
  for (const p of ordered) visit(p, []);
  return out;
}
