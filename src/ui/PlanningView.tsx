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

import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import {
  assignToGroup,
  groupOf,
  groupRootsOf,
  membersOfGroup,
  removeFromGroup,
} from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { visibleRows } from './outline.ts';
import { coveringGroups, overlappingMembers, rootGroupOf } from './planning.ts';
import { Outliner } from './Outliner.tsx';
import type { RowDropProps } from './OutlinerRow.tsx';

const GROUP_COLORS = [
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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function PlanningView({ selectedId, onSelect }: PlanningViewProps) {
  const graph = useProjectGraph();
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [specDropping, setSpecDropping] = useState(false);

  const specRows = visibleRows(graph, NO_COLLAPSE, 'work');
  const groupRoots = groupRootsOf(graph);

  function colorOf(groupId: string): string {
    const index = groupRoots.indexOf(rootGroupOf(graph, groupId));
    return GROUP_COLORS[(index < 0 ? 0 : index) % GROUP_COLORS.length]!;
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
    if (members.length === 0) return null;
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
        <div className="pane-title">Spec — drag items onto groups</div>
        {specRows.length === 0 && (
          <p className="pane-hint">The spec is empty. Add items in the Spec view first.</p>
        )}
        {specRows.map((row) => {
          const node = graph.nodes[row.id]!;
          const coverage = coveringGroups(graph, row.id);
          return (
            <div
              key={row.id}
              className={`plan-tree-row${row.id === selectedId ? ' row-selected' : ''}`}
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
        <div className="pane-title">Delivery plan</div>
        <Outliner
          side="group"
          selectedId={selectedId}
          onSelect={onSelect}
          emptyHint="No delivery plan yet. Groups nest freely — blocks of epics, epics of sub-epics."
          emptyButtonLabel="Add the first group"
          addLabel="+ Add group"
          rowExtras={rowExtras}
          rowDropProps={rowDropProps}
        />
      </div>
    </div>
  );
}
