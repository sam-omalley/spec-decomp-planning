/**
 * Planning view: a projection of 'belongs_to_epic' edges for the active
 * plan. Left pane shows the spec tree (read-only here); drag a node onto
 * an epic to assign it — assigning a parent covers its whole subtree.
 * Dragging a chip between epics moves the assignment atomically.
 *
 * Overlaps (a member with a descendant in another epic of the same plan)
 * are allowed and badged, never forbidden.
 */

import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  assignToEpic,
  createEpic,
  createId,
  createPlan,
  deleteNode,
  deletePlan,
  edgeBetween,
  membersOfEpic,
  removeFromEpic,
  renamePlan,
  updateNode,
} from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { visibleRows } from './outline.ts';
import {
  coveringEpicsInPlan,
  epicsOfPlanOrdered,
  overlappingMembers,
  plansOrdered,
} from './planning.ts';

const EPIC_COLORS = [
  '#4667d4',
  '#0e9f6e',
  '#c2410c',
  '#8a63d2',
  '#0e8fa5',
  '#b42318',
  '#a16207',
  '#be3a8f',
];

const NO_COLLAPSE: ReadonlySet<string> = new Set();

interface PlanningViewProps {
  activePlanId: string | null;
  onSwitchPlan: (planId: string | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PlanningView({
  activePlanId,
  onSwitchPlan,
  selectedId,
  onSelect,
}: PlanningViewProps) {
  const graph = useProjectGraph();
  const [dropEpicId, setDropEpicId] = useState<string | null>(null);
  const [focusEpicId, setFocusEpicId] = useState<string | null>(null);
  const epicTitleRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (focusEpicId === null) return;
    const el = epicTitleRefs.current.get(focusEpicId);
    if (el) {
      el.focus();
      el.select();
      setFocusEpicId(null);
    }
  }, [focusEpicId]);

  const plans = plansOrdered(graph);
  const plan = activePlanId !== null ? graph.plans[activePlanId] : undefined;

  function addPlan() {
    const id = createId();
    store.commit((g) => createPlan(g, { id, name: `Plan ${plans.length + 1}` }));
    onSwitchPlan(id);
  }

  if (plan === undefined) {
    return (
      <div className="outliner-empty">
        <p>No plans yet. A plan is a named way of grouping the spec into epics.</p>
        <button className="button-primary" onClick={addPlan}>
          Create the first plan
        </button>
      </div>
    );
  }

  const planId = plan.id;
  const epicIds = epicsOfPlanOrdered(graph, planId);
  const colorOf = new Map(epicIds.map((id, i) => [id, EPIC_COLORS[i % EPIC_COLORS.length]!]));
  const rows = visibleRows(graph, NO_COLLAPSE);

  function removeActivePlan() {
    const ok = window.confirm(
      `Delete plan “${plan!.name}” and its ${epicIds.length} epic${
        epicIds.length === 1 ? '' : 's'
      }? The spec itself is untouched.`,
    );
    if (!ok) return;
    store.commit((g) => deletePlan(g, planId));
    onSwitchPlan(null);
  }

  function addEpic() {
    const id = createId();
    store.commit((g) => createEpic(g, planId, { id, title: 'New epic' }));
    setFocusEpicId(id);
  }

  function removeEpic(epicId: string) {
    const members = membersOfEpic(graph, epicId);
    if (members.length > 0) {
      const title = graph.nodes[epicId]?.title ?? 'epic';
      const ok = window.confirm(
        `Delete epic “${title}”? Its ${members.length} assignment${
          members.length === 1 ? '' : 's'
        } are removed; the tasks stay in the spec.`,
      );
      if (!ok) return;
    }
    store.commit((g) => deleteNode(g, epicId));
  }

  function onDragStartNode(event: DragEvent, nodeId: string, fromEpicId?: string) {
    event.dataTransfer.setData('text/plain', `${nodeId}:${fromEpicId ?? ''}`);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDropOnEpic(event: DragEvent, epicId: string) {
    event.preventDefault();
    setDropEpicId(null);
    const [nodeId, fromEpicId] = event.dataTransfer.getData('text/plain').split(':');
    if (!nodeId || fromEpicId === epicId) return;
    store.commit((g) => {
      const node = g.nodes[nodeId];
      if (!node || node.type === 'epic') return g;
      if (edgeBetween(g, 'belongs_to_epic', nodeId, epicId)) return g;
      if (fromEpicId) g = removeFromEpic(g, nodeId, fromEpicId);
      return assignToEpic(g, nodeId, epicId);
    });
    onSelect(nodeId);
  }

  return (
    <div className="planning">
      <div className="plan-bar">
        {plans.map((p) =>
          p.id === planId ? (
            <div key={p.id} className="plan-tab plan-tab-active">
              <input
                className="plan-name-input"
                value={p.name}
                style={{ width: `${Math.max(p.name.length, 4) + 1}ch` }}
                onChange={(e) =>
                  store.commit((g) => renamePlan(g, p.id, e.target.value), {
                    coalesce: `plan:${p.id}`,
                  })
                }
                onBlur={() => store.breakCoalescing()}
              />
              <button
                className="icon-button"
                title="Delete plan"
                onClick={removeActivePlan}
              >
                ×
              </button>
            </div>
          ) : (
            <button key={p.id} className="plan-tab" onClick={() => onSwitchPlan(p.id)}>
              {p.name}
            </button>
          ),
        )}
        <button className="plan-tab plan-tab-new" title="New plan" onClick={addPlan}>
          +
        </button>
      </div>

      <div className="planning-body">
        <div className="plan-tree">
          <div className="pane-title">Spec — drag items onto epics</div>
          {rows.length === 0 && (
            <p className="pane-hint">The spec is empty. Add items in the Spec view first.</p>
          )}
          {rows.map((row) => {
            const node = graph.nodes[row.id]!;
            const coverage = coveringEpicsInPlan(graph, row.id, planId);
            return (
              <div
                key={row.id}
                className={`plan-tree-row${row.id === selectedId ? ' row-selected' : ''}`}
                style={{ paddingLeft: `${row.depth * 18 + 8}px` }}
                draggable
                onDragStart={(e) => onDragStartNode(e, row.id)}
                onClick={() => onSelect(row.id)}
              >
                <span className="bullet" />
                <span className="plan-tree-title">
                  {node.title.trim() === '' ? 'Untitled' : node.title}
                </span>
                {coverage.map(({ epicId, via }) => (
                  <span
                    key={epicId}
                    className={`epic-tag${via === row.id ? '' : ' epic-tag-inherited'}`}
                    style={{ ['--epic-color' as string]: colorOf.get(epicId) }}
                    title={
                      via === row.id
                        ? graph.nodes[epicId]?.title
                        : `${graph.nodes[epicId]?.title} — via ${graph.nodes[via]?.title}`
                    }
                  >
                    {graph.nodes[epicId]?.title}
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        <div className="plan-board">
          <div className="pane-title">
            Epics
            <button className="add-row" onClick={addEpic}>
              + New epic
            </button>
          </div>
          {epicIds.length === 0 && (
            <p className="pane-hint">No epics yet. Create one, then drag spec items onto it.</p>
          )}
          <div className="epic-grid">
            {epicIds.map((epicId) => {
              const epic = graph.nodes[epicId]!;
              const members = membersOfEpic(graph, epicId);
              const overlaps = new Set(overlappingMembers(graph, epicId));
              return (
                <div
                  key={epicId}
                  className={`epic-card${dropEpicId === epicId ? ' epic-card-drop' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropEpicId(epicId);
                  }}
                  onDragLeave={() => setDropEpicId(null)}
                  onDrop={(e) => onDropOnEpic(e, epicId)}
                >
                  <div className="epic-header">
                    <span
                      className="epic-dot"
                      style={{ background: colorOf.get(epicId) }}
                    />
                    <input
                      ref={(el) => {
                        if (el) epicTitleRefs.current.set(epicId, el);
                        else epicTitleRefs.current.delete(epicId);
                      }}
                      className="epic-title-input"
                      value={epic.title}
                      onChange={(e) =>
                        store.commit((g) => updateNode(g, epicId, { title: e.target.value }), {
                          coalesce: `title:${epicId}`,
                        })
                      }
                      onBlur={() => store.breakCoalescing()}
                    />
                    {overlaps.size > 0 && (
                      <span
                        className="overlap-badge"
                        title={
                          'Overlap: descendants of ' +
                          [...overlaps]
                            .map((id) => `“${graph.nodes[id]?.title}”`)
                            .join(', ') +
                          ' are also in other epics of this plan'
                        }
                      >
                        ⚠ {overlaps.size}
                      </span>
                    )}
                    <button
                      className="icon-button"
                      title="Delete epic"
                      onClick={() => removeEpic(epicId)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="epic-members">
                    {members.length === 0 && <span className="pane-hint">Drop items here</span>}
                    {members.map((memberId) => (
                      <span
                        key={memberId}
                        className={`member-chip${
                          memberId === selectedId ? ' member-chip-selected' : ''
                        }${overlaps.has(memberId) ? ' member-chip-overlap' : ''}`}
                        draggable
                        onDragStart={(e) => onDragStartNode(e, memberId, epicId)}
                        onClick={() => onSelect(memberId)}
                      >
                        {graph.nodes[memberId]?.title.trim() || 'Untitled'}
                        <button
                          className="icon-button"
                          title="Remove from epic"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.commit((g) => removeFromEpic(g, memberId, epicId));
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
