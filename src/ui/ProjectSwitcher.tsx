/**
 * Header control for switching between local projects (#134): a dropdown
 * (opening rightward — it sits near the header's left edge) listing every
 * known project, plus the current project's lifecycle actions — New,
 * Duplicate, Rename, Delete (#151: this is the one place a user should
 * think to look for "manage the project", rather than needing a side trip
 * to Settings for rename/delete). Settings' Projects card still exists as
 * a fuller table (dates, inline rename, bulk cleanup across many
 * projects) — this dropdown is the quick path for the common case.
 */

import { useState } from 'react';
import { useActiveProjectId, useProjects } from '../store/appStore.ts';
import {
  createNewProject,
  deleteProjectAction,
  duplicateActiveProject,
  renameActiveOrOtherProject,
  switchProject,
} from '../store/projectActions.ts';
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

  async function rename() {
    const name = window.prompt('Rename this project', activeName);
    if (name === null) return; // cancelled
    const trimmed = name.trim();
    if (!trimmed || trimmed === activeName) return;
    setBusy(true);
    try {
      await renameActiveOrOtherProject(activeId, trimmed);
    } finally {
      setBusy(false);
    }
  }

  async function removeActive() {
    const isOnly = projects.length === 1;
    const warning = isOnly
      ? `Delete “${activeName}”? It's your only project, so a fresh empty one will open in its place. This cannot be undone.`
      : `Delete “${activeName}”? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      await deleteProjectAction(activeId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HeaderMenu label={`${activeName} ▾`} title="Project" align="start">
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
      <button onClick={() => void rename()} title="Rename the current project">
        ✎ Rename current…
      </button>
      <div className="header-menu-divider" />
      <button onClick={() => void removeActive()} title="Delete the current project">
        Delete current project
      </button>
    </HeaderMenu>
  );
}
