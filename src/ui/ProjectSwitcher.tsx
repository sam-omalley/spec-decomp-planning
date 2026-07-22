/**
 * Header control for switching between local projects (#134): a dropdown
 * (opening rightward — it sits near the header's left edge) listing every
 * known project, plus a quick "+ New project" and "⧉ Duplicate current".
 * Renaming and deleting live in Settings' Projects card instead — those
 * need an inline text input, which doesn't fit `HeaderMenu`'s
 * closes-on-any-click behaviour.
 */

import { useState } from 'react';
import { useActiveProjectId, useProjects } from '../store/appStore.ts';
import { createNewProject, duplicateActiveProject, switchProject } from '../store/projectActions.ts';
import { HeaderMenu } from './HeaderMenu.tsx';

export function ProjectSwitcher() {
  const activeId = useActiveProjectId();
  const projects = useProjects();
  const [busy, setBusy] = useState(false);
  const active = projects.find((p) => p.id === activeId);
  const activeName = active?.name.trim() || 'Untitled';

  async function pick(id: string) {
    if (busy || id === activeId) return;
    setBusy(true);
    try {
      await switchProject(id);
    } catch {
      window.alert('Could not open that project — its saved data may be corrupt.');
    } finally {
      setBusy(false);
    }
  }

  async function addNew() {
    const name = window.prompt('Name this project', 'Untitled');
    if (name === null) return; // cancelled
    setBusy(true);
    try {
      await createNewProject(name);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    const name = window.prompt('Name the copy', `${activeName} copy`);
    if (name === null) return; // cancelled
    setBusy(true);
    try {
      await duplicateActiveProject(name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HeaderMenu label={`${activeName} ▾`} title="Switch project" align="start">
      {projects.map((p) => (
        <button
          key={p.id}
          className={p.id === activeId ? 'project-menu-item project-menu-item-active' : 'project-menu-item'}
          onClick={() => void pick(p.id)}
        >
          {p.id === activeId ? '● ' : ''}
          {p.name.trim() || 'Untitled'}
        </button>
      ))}
      <div className="header-menu-divider" />
      <button onClick={() => void addNew()}>+ New project</button>
      <button onClick={() => void duplicate()} title="Copy the current project — handy for what-ifs">
        ⧉ Duplicate current
      </button>
      <div className="header-menu-divider" />
      <span className="settings-note project-menu-hint">Rename or delete in ⚙ Settings</span>
    </HeaderMenu>
  );
}
