/**
 * Planning view: the delivery tree (groups all the way down — blocks,
 * epics, whatever depth you need) as a keyboard-first outliner, plus a
 * read-only spec pane to drag work items from. Dropping a work item on
 * a group assigns it; a work item lives in at most one group, so a
 * second drop moves it. Dragging a chip back onto the spec pane
 * unassigns it.
 *
 * Overlaps (a member with a spec-descendant assigned outside the
 * member's group subtree) are allowed and badged, never forbidden.
 */

import { useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import {
  assignToGroup,
  groupOf,
  membersOfGroup,
  removeFromGroup,
} from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { rootGroupColor } from './colors.ts';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import { visibleRows } from './outline.ts';
import {
  coveringGroups,
  isEmptyLeafGroup,
  overlappingMembers,
  uncoveredWorkIds,
} from './planning.ts';
import { Outliner } from './Outliner.tsx';
import type { RowDropProps } from './OutlinerRow.tsx';
import { PlanTable } from './PlanTable.tsx';

const NO_COLLAPSE: ReadonlySet<string> = new Set();

interface PlanningViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Outline vs Table sub-view; lifted so the footer hint can follow it. */
  mode: 'outline' | 'table';
  onModeChange: (mode: 'outline' | 'table') => void;
  /** Global filter, shared across tabs. */
  filter?: FilterState;
}

export function PlanningView({
  selectedId,
  onSelect,
  mode,
  onModeChange,
  filter = EMPTY_FILTER,
}: PlanningViewProps) {
  const graph = useProjectGraph();
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [specDropping, setSpecDropping] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const filterActive = isFilterActive(filter);
  const specRows = visibleRows(
    graph,
    NO_COLLAPSE,
    'work',
    filterActive ? (id) => matchesFilter(graph.nodes[id]!, filter) : undefined,
  );
  const uncovered = useMemo(() => uncoveredWorkIds(graph), [graph]);
  const shownSpecRows = onlyUnassigned
    ? specRows.filter((row) => uncovered.has(row.id))
    : specRows;
  const emptyGroupCount = useMemo(
    () => Object.keys(graph.nodes).filter((id) => isEmptyLeafGroup(graph, id)).length,
    [graph],
  );

  function colorOf(groupId: string): string {
    return rootGroupColor(graph, groupId);
  }

  function startDrag(event: DragEvent, source: 'spec' | 'chip', nodeId: string) {
    event.dataTransfer.setData('text/plain', `${source}:${nodeId}`);
    event.dataTransfer.effectAllowed = 'move';
  }

  function payloadOf(event: DragEvent): { source: string; nodeId: string } | null {
    const [source, nodeId] = event.dataTransfer.getData('text/plain').split(':');
    return source && nodeId ? { source, nodeId } : null;
  }

  function dropOnGroup(event: DragEvent, groupId: string) {
    event.preventDefault();
    setDropGroupId(null);
    const payload = payloadOf(event);
    if (!payload) return;
    const { nodeId } = payload;
    store.commit((g) => {
      const node = g.nodes[nodeId];
      if (!node || node.type === 'group' || !g.nodes[groupId]) return g;
      return assignToGroup(g, nodeId, groupId);
    });
    onSelect(nodeId);
  }

  function dropOnSpec(event: DragEvent) {
    event.preventDefault();
    setSpecDropping(false);
    const payload = payloadOf(event);
    if (!payload || payload.source !== 'chip') return;
    store.commit((g) =>
      groupOf(g, payload.nodeId) === null ? g : removeFromGroup(g, payload.nodeId),
    );
  }

  function rowDropProps(groupId: string): RowDropProps {
    return {
      dropping: dropGroupId === groupId,
      onDragOver: (e) => {
        e.preventDefault();
        setDropGroupId(groupId);
      },
      onDragLeave: () => setDropGroupId((current) => (current === groupId ? null : current)),
      onDrop: (e) => dropOnGroup(e, groupId),
    };
  }

  function rowExtras(groupId: string): ReactNode {
    const members = membersOfGroup(graph, groupId);
    const overlaps = new Set(overlappingMembers(graph, groupId));
    if (members.length === 0) {
      return isEmptyLeafGroup(graph, groupId) ? (
        <span className="empty-badge" title="No work items assigned to this group">
          empty
        </span>
      ) : null;
    }
    return (
      <>
        {overlaps.size > 0 && (
          <span
            className="overlap-badge"
            title={
              'Overlap: descendants of ' +
              [...overlaps].map((id) => `“${graph.nodes[id]?.title}”`).join(', ') +
              ' are assigned outside this group'
            }
          >
            ⚠ {overlaps.size}
          </span>
        )}
        <div className="row-chips">
          {members.map((memberId) => (
            <span
              key={memberId}
              className={`member-chip${
                memberId === selectedId ? ' member-chip-selected' : ''
              }${overlaps.has(memberId) ? ' member-chip-overlap' : ''}`}
              draggable
              onDragStart={(e) => startDrag(e, 'chip', memberId)}
              onClick={() => onSelect(memberId)}
            >
              {graph.nodes[memberId]?.title.trim() || 'Untitled'}
              <button
                className="icon-button"
                title="Remove from group"
                onClick={(e) => {
                  e.stopPropagation();
                  store.commit((g) => removeFromGroup(g, memberId));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="plan-mode-toggle">
        <button
          className={mode === 'outline' ? 'view-tab view-tab-active' : 'view-tab'}
          onClick={() => onModeChange('outline')}
        >
          Outline
        </button>
        <button
          className={mode === 'table' ? 'view-tab view-tab-active' : 'view-tab'}
          onClick={() => onModeChange('table')}
        >
          Table
        </button>
      </div>
      {mode === 'table' ? (
        <PlanTable selectedId={selectedId} onSelect={onSelect} filter={filter} />
      ) : (
        <div className="planning-body">
      <div
        className={`plan-tree${specDropping ? ' plan-tree-drop' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setSpecDropping(true);
        }}
        onDragLeave={() => setSpecDropping(false)}
        onDrop={dropOnSpec}
      >
        <div className="pane-title pane-title-sticky">
          <span>Spec — drag items onto groups</span>
          <label className="pane-filter" title="Show only spec items no group covers">
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={(e) => setOnlyUnassigned(e.target.checked)}
            />
            Unassigned ({uncovered.size})
          </label>
        </div>
        {specRows.length === 0 && (
          <p className="pane-hint">
            {filterActive
              ? 'No spec items match the filter.'
              : 'The spec is empty. Add items in the Spec view first.'}
          </p>
        )}
        {specRows.length > 0 && shownSpecRows.length === 0 && (
          <p className="pane-hint">Every spec item is assigned to a group. 🎉</p>
        )}
        {shownSpecRows.map((row) => {
          const node = graph.nodes[row.id]!;
          const coverage = coveringGroups(graph, row.id);
          return (
            <div
              key={row.id}
              className={`plan-tree-row${row.id === selectedId ? ' row-selected' : ''}${
                row.matched === false ? ' row-context' : row.matched ? ' row-match' : ''
              }`}
              style={{ paddingLeft: `${row.depth * 18 + 8}px` }}
              draggable
              onDragStart={(e) => startDrag(e, 'spec', row.id)}
              onClick={() => onSelect(row.id)}
            >
              <span className="bullet" />
              <span className="plan-tree-title">
                {node.title.trim() === '' ? 'Untitled' : node.title}
              </span>
              {node.description.trim() !== '' && (
                <span className="details-indicator details-indicator-static" title={node.description}>
                  ≡
                </span>
              )}
              {coverage.map(({ groupId, via }) => (
                <span
                  key={groupId}
                  className={`epic-tag${via === row.id ? '' : ' epic-tag-inherited'}`}
                  style={{ ['--epic-color' as string]: colorOf(groupId) }}
                  title={
                    via === row.id
                      ? graph.nodes[groupId]?.title
                      : `${graph.nodes[groupId]?.title} — via ${graph.nodes[via]?.title}`
                  }
                >
                  {graph.nodes[groupId]?.title.trim() || 'Untitled'}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      <div className="plan-board">
        <div className="pane-title pane-title-sticky">
          <span>Delivery plan</span>
          {emptyGroupCount > 0 && (
            <span className="empty-badge" title="Leaf groups with no work items assigned">
              {emptyGroupCount} empty
            </span>
          )}
        </div>
        <Outliner
          side="group"
          selectedId={selectedId}
          onSelect={onSelect}
          emptyHint="No delivery plan yet. Groups nest freely — blocks of epics, epics of sub-epics."
          emptyButtonLabel="Add the first group"
          addLabel="+ Add group"
          rowExtras={rowExtras}
          rowDropProps={rowDropProps}
          filter={filter}
        />
      </div>
        </div>
      )}
    </>
  );
}
