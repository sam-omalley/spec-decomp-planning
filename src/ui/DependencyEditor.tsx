/**
 * "Depends on" editor inside a work row's details card: current
 * prerequisites as removable chips plus a type-to-search input for
 * adding one. Creates 'depends_on' edges; removal also handles
 * prerequisites that arrived via an inverse 'blocks' edge.
 */

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { prerequisitesOf } from '../model/analysis.ts';
import { addEdge, edgeBetween, removeEdge, updateDependency } from '../model/graph.ts';
import type { DepKind } from '../model/types.ts';
import { store, useProjectGraph } from '../store/appStore.ts';

interface DependencyEditorProps {
  id: string;
}

export function DependencyEditor({ id }: DependencyEditorProps) {
  const graph = useProjectGraph();
  const [query, setQuery] = useState('');

  const prerequisites = prerequisitesOf(graph, id);
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? []
      : Object.values(graph.nodes)
          .filter(
            (n) =>
              n.type === 'group' &&
              n.id !== id &&
              !prerequisites.includes(n.id) &&
              n.title.toLowerCase().includes(needle),
          )
          .slice(0, 6);

  function add(targetId: string) {
    store.commit((g) => {
      if (!g.nodes[targetId] || edgeBetween(g, 'depends_on', id, targetId)) return g;
      return addEdge(g, { type: 'depends_on', from: id, to: targetId });
    });
    setQuery('');
  }

  function remove(targetId: string) {
    store.commit((g) => {
      const direct = edgeBetween(g, 'depends_on', id, targetId);
      if (direct) return removeEdge(g, direct.id);
      const viaBlocks = edgeBetween(g, 'blocks', targetId, id);
      return viaBlocks ? removeEdge(g, viaBlocks.id) : g;
    });
  }

  /** The underlying edge for a prerequisite chip — direct 'depends_on' or
   *  an inverse 'blocks', same lookup `remove` uses (#132: needed to read/
   *  patch its kind/lag). */
  function edgeFor(targetId: string) {
    return edgeBetween(graph, 'depends_on', id, targetId) ?? edgeBetween(graph, 'blocks', targetId, id);
  }

  function setKind(edgeId: string, depKind: DepKind) {
    store.commit((g) => updateDependency(g, edgeId, { depKind }));
  }

  function setLag(edgeId: string, raw: string) {
    if (raw.trim() === '') return;
    const lagDays = Number(raw);
    if (!Number.isFinite(lagDays)) return;
    store.commit((g) => updateDependency(g, edgeId, { lagDays }), { coalesce: `dep-lag:${edgeId}` });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[0]) add(matches[0].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query !== '') setQuery('');
      else event.currentTarget.blur();
    }
  }

  return (
    <div className="dep-editor">
      <span className="dep-label">Depends on</span>
      {prerequisites.map((p) => {
        const edge = edgeFor(p);
        return (
          <span key={p} className="dep-chip">
            {graph.nodes[p]?.title.trim() || 'Untitled'}
            {edge && (
              <>
                <select
                  className="dep-kind-select"
                  title="Dependency kind: finish-to-start (default) or start-to-start"
                  value={edge.depKind ?? 'FS'}
                  onChange={(e) => setKind(edge.id, e.target.value as DepKind)}
                >
                  <option value="FS">FS</option>
                  <option value="SS">SS</option>
                </select>
                <input
                  type="number"
                  step={1}
                  className="dep-lag-input"
                  title="Lag in working days — negative is a lead (overlap)"
                  value={edge.lagDays ?? 0}
                  onChange={(e) => setLag(edge.id, e.target.value)}
                  onBlur={() => store.breakCoalescing()}
                />
              </>
            )}
            <button
              className="icon-button"
              title="Remove dependency"
              onClick={() => remove(p)}
            >
              ×
            </button>
          </span>
        );
      })}
      <span className="dep-input-wrap">
        <input
          className="dep-input"
          placeholder={prerequisites.length === 0 ? 'add a dependency…' : 'add…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {matches.length > 0 && (
          <div className="dep-suggestions">
            {matches.map((m) => (
              <button
                key={m.id}
                className="dep-suggestion"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(m.id)}
              >
                {m.title.trim() || 'Untitled'}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
