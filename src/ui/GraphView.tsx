/**
 * Graph view: the whole graph on one canvas. The spec forest grows
 * left-to-right, the delivery forest is mirrored right-to-left, and
 * dashed 'assigned_to' edges bridge the gap — nested inputs facing
 * nested outputs. Positions come from the pure layout in graphLayout.ts;
 * React Flow only renders.
 *
 * Interactions: pan, zoom, click to select (synced with the other
 * views). Filters (Unassigned work / Empty groups, toggled together)
 * either spotlight matches by dimming the rest or hide the rest
 * outright.
 *
 * Assignment is authored here with the same handle-drag UX as the
 * Dependency view (issue #31): drag a spec node's **right** handle onto a
 * group node's **left** handle to create an `assigned_to` edge (single
 * membership, so it moves an existing assignment). Loose connection mode
 * lets either end start; `isValidConnection` accepts only a work-right ↔
 * group-left pair (`mapAuthoring.ts`). During a drag each card reveals only
 * its valid handle. An existing assignment edge is grabbable near an end:
 * drop it on another group to re-home the assignment, or on empty space to
 * unassign.
 *
 * Sort mode (issue #42): a 3-way toggle — Both locked (default, each side
 * keeps its own native order) / Lock Spec / Lock Plan — passed straight
 * through to `layoutGraph`'s `sort` param (`graphLayout.ts` does the actual
 * re-flow). Ephemeral view state, like `inferChains`; never serialized.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type {
  Connection,
  Edge as FlowEdge,
  Node as FlowNode,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cycleIndexOf, waitingMap } from '../model/analysis.ts';
import { assignToGroup, removeEdge } from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { AuthoringCanvas, makeArrowConnectionLine, useConnectionSignature } from './AuthoringCanvas.tsx';
import { rootGroupColor } from './colors.ts';
import { DependencyGraph } from './DependencyGraph.tsx';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import { layoutGraph, type MapSort } from './graphLayout.ts';
import { assignmentHandleVisibility, resolveAssignmentEnds } from './mapAuthoring.ts';
import { isEmptyLeafGroup, uncoveredWorkIds } from './planning.ts';

type FilterKey = 'unassigned' | 'empty';
/** Spotlight dims non-matches in place; hide removes them entirely. */
type FilterMode = 'spotlight' | 'hide';
/** Map = the spec↔plan mirror; Dependency = the leaf-group dep DAG. */
export type GraphMode = 'map' | 'dep';

interface GNodeData extends Record<string, unknown> {
  title: string;
  hasDetails: boolean;
  isSelected: boolean;
  isDone: boolean;
  isWaiting: boolean;
  inCycle: boolean;
  dimmed: boolean;
  matched: boolean;
  color?: string;
}

type GNode = FlowNode<GNodeData>;
/** graphEdgeId is set only on real, grabbable `assigned_to` edges. */
interface GEdgeData extends Record<string, unknown> {
  graphEdgeId?: string;
}

/** The show/hide drag class for a card's assignment handle, or ''. */
function dragClass(conn: string, nodeId: string, nodeIsGroup: boolean): string {
  if (!conn) return '';
  const sep = conn.indexOf(':');
  const vis = assignmentHandleVisibility(nodeId, nodeIsGroup, conn.slice(0, sep), conn.slice(sep + 1));
  return vis === 'show' ? 'dephandle-drag-show' : vis === 'hide' ? 'dephandle-drag-hide' : '';
}

function WorkGraphNode({ id, data }: NodeProps<GNode>) {
  const classes = [
    'gnode',
    'gnode-work',
    data.isSelected ? 'gnode-selected' : '',
    data.isDone ? 'gnode-done' : '',
    data.inCycle ? 'gnode-cycle' : data.isWaiting ? 'gnode-waiting' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // The right handle authors assignments (spec → plan); the left handle only
  // renders incoming contains edges, so it is not connectable.
  const rightDrag = dragClass(useConnectionSignature(), id, false);
  return (
    <div className={classes}>
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" isConnectable={false} />
      <span className="gnode-title" title={data.title.trim() || 'Untitled'}>
        {data.title.trim() || 'Untitled'}
      </span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle
        type="source"
        position={Position.Right}
        id="rs"
        className={`ghandle dephandle ${rightDrag}`}
      />
    </div>
  );
}

function GroupGraphNode({ id, data }: NodeProps<GNode>) {
  const classes = [
    'gnode',
    'gnode-group',
    data.isSelected ? 'gnode-selected' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // The left target handle receives assignments (spec → plan); the left source
  // (contains, group tree) and right target (contains, from parent) only
  // render existing edges, so they are not connectable.
  const leftDrag = dragClass(useConnectionSignature(), id, true);
  return (
    <div className={classes} style={{ ['--group-color' as string]: data.color }}>
      <Handle type="source" position={Position.Left} id="ls" className="ghandle" isConnectable={false} />
      <Handle
        type="target"
        position={Position.Left}
        id="lt"
        className={`ghandle dephandle ${leftDrag}`}
      />
      <span className="gnode-title" title={data.title.trim() || 'Untitled'}>
        {data.title.trim() || 'Untitled'}
      </span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="target" position={Position.Right} id="rt" className="ghandle" isConnectable={false} />
    </div>
  );
}

const nodeTypes = { work: WorkGraphNode, group: GroupGraphNode };

/** In-progress assignment line: a dashed link whose arrow points at the group
 *  (the plan side the work flows into), previewing the `assigned_to` edge. */
const MapConnectionLine = makeArrowConnectionLine({ color: '#9aa0a6', arrowAtFromHandleId: 'lt' });

interface GraphViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Global filter, shared across tabs; dims non-matches in place. */
  filter?: FilterState;
  /** Map vs Dependency mode; selected by the header sub-tab bar. */
  mode: GraphMode;
}

export function GraphView({
  selectedId,
  onSelect,
  filter = EMPTY_FILTER,
  mode: graphMode,
}: GraphViewProps) {
  const graph = useProjectGraph();
  const [inferChains, setInferChains] = useState(false);
  // Sort mode for the Map view (issue #42): ephemeral view state, like
  // inferChains — never serialized, resets to the default on reload.
  const [mapSort, setMapSort] = useState<MapSort>('locked');
  const [active, setActive] = useState<Record<FilterKey, boolean>>({
    unassigned: false,
    empty: false,
  });
  const [mode, setMode] = useState<FilterMode>('spotlight');

  const analysis = useMemo(
    () => ({ waiting: waitingMap(graph), cycles: cycleIndexOf(graph) }),
    [graph],
  );

  const highlight = useMemo(() => {
    const unassigned = uncoveredWorkIds(graph);
    const empty = new Set(
      Object.keys(graph.nodes).filter((id) => isEmptyLeafGroup(graph, id)),
    );
    return { unassigned, empty };
  }, [graph]);

  const anyFilter = active.unassigned || active.empty;

  const matches = useCallback(
    (id: string): boolean =>
      (active.unassigned && highlight.unassigned.has(id)) ||
      (active.empty && highlight.empty.has(id)),
    [active, highlight],
  );

  const isGroup = useCallback(
    (id: string): boolean => graph.nodes[id]?.type === 'group',
    [graph],
  );

  // Author an assignment by dragging a spec node's right handle onto a group's
  // left handle (single membership, so it moves any existing assignment).
  const onConnect = useCallback(
    (connection: Connection) => {
      const ends = resolveAssignmentEnds(connection, isGroup);
      if (!ends) return;
      const { workId, groupId } = ends;
      store.commit((g) => {
        if (!g.nodes[workId] || g.nodes[workId]!.type === 'group') return g;
        if (g.nodes[groupId]?.type !== 'group') return g;
        return assignToGroup(g, workId, groupId);
      });
      onSelect(workId);
    },
    [isGroup, onSelect],
  );

  // Grabbing an assignment arrow near an end reconnects it: dropping on a valid
  // handle re-homes the assignment; dropping on empty space unassigns. Only a
  // real backing edge (graphEdgeId) is grabbable. `reconnected` distinguishes a
  // valid re-home from a drop into space (delete).
  const reconnected = useRef(false);
  const onReconnectStart = useCallback(() => {
    reconnected.current = false;
  }, []);
  const onReconnect = useCallback(
    (oldEdge: FlowEdge<GEdgeData>, connection: Connection) => {
      const ends = resolveAssignmentEnds(connection, isGroup);
      const graphEdgeId = oldEdge.data?.graphEdgeId;
      if (!ends || !graphEdgeId) return; // invalid drop → onReconnectEnd deletes
      reconnected.current = true;
      const { workId, groupId } = ends;
      store.commit((g) => {
        const next = g.edges[graphEdgeId] ? removeEdge(g, graphEdgeId) : g;
        if (!next.nodes[workId] || next.nodes[workId]!.type === 'group') return next;
        if (next.nodes[groupId]?.type !== 'group') return next;
        return assignToGroup(next, workId, groupId);
      });
      onSelect(workId);
    },
    [isGroup, onSelect],
  );
  const onReconnectEnd = useCallback((_: unknown, edge: FlowEdge<GEdgeData>) => {
    if (reconnected.current) return; // already re-homed in onReconnect
    const graphEdgeId = edge.data?.graphEdgeId;
    if (!graphEdgeId) return;
    store.commit((g) => (g.edges[graphEdgeId] ? removeEdge(g, graphEdgeId) : g));
  }, []);

  // The global text filter always dims non-matches in place (never hides),
  // so the graph's structure stays legible; it composes with the local
  // unassigned/empty spotlight above.
  const textActive = isFilterActive(filter);
  const textMatch = useCallback(
    (id: string): boolean => {
      const node = graph.nodes[id];
      return node ? matchesFilter(node, filter) : false;
    },
    [graph, filter],
  );

  const hiding = anyFilter && mode === 'hide';

  // In hide mode, lay out only the survivors so they re-flow compactly
  // instead of sitting at their full-graph positions with gaps.
  const visibleSet = useMemo(() => {
    if (!hiding) return undefined;
    const set = new Set<string>();
    for (const id of Object.keys(graph.nodes)) if (matches(id)) set.add(id);
    return set;
  }, [graph, hiding, matches]);

  const nodes = useMemo<GNode[]>(() => {
    const result: GNode[] = [];
    for (const placed of layoutGraph(graph, visibleSet, mapSort)) {
      const node = graph.nodes[placed.id]!;
      const matched = matches(placed.id);
      result.push({
        id: placed.id,
        type: placed.side,
        position: { x: placed.x, y: placed.y },
        data: {
          title: node.title,
          hasDetails: node.description.trim() !== '',
          isSelected: placed.id === selectedId,
          isDone: node.status === 'done',
          isWaiting: analysis.waiting.has(placed.id),
          inCycle: analysis.cycles.has(placed.id),
          dimmed:
            (textActive && !textMatch(placed.id)) ||
            (anyFilter && mode === 'spotlight' && !matched),
          matched: (textActive && textMatch(placed.id)) || (anyFilter && matched),
          ...(placed.side === 'group' ? { color: rootGroupColor(graph, placed.id) } : {}),
        },
        draggable: false,
        connectable: true,
      });
    }
    return result;
  }, [
    graph,
    selectedId,
    analysis,
    anyFilter,
    mode,
    mapSort,
    matches,
    visibleSet,
    textActive,
    textMatch,
  ]);

  // Edges to a node hidden in hide mode would dangle, so keep only those
  // whose endpoints are both on the canvas.
  const visibleIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const edges = useMemo<FlowEdge<GEdgeData>[]>(() => {
    const result: FlowEdge<GEdgeData>[] = [];
    for (const edge of Object.values(graph.edges)) {
      if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
      // Dependency (depends_on/blocks) arrows are deliberately not drawn here —
      // this canvas is for assignment authoring, and a plan with non-trivial
      // dependencies gets visually unreadable once those arrows are layered
      // on top of contains/assigned_to. They have their own canvas (Dependency
      // mode) where the layout is built around showing them clearly.
      if (edge.type === 'contains') {
        const groupSide = graph.nodes[edge.from]?.type === 'group';
        result.push({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          // Spec tree flows rightwards, group tree leftwards.
          sourceHandle: groupSide ? 'ls' : 'rs',
          targetHandle: groupSide ? 'rt' : 'lt',
          className: 'gedge-contains',
        });
      } else if (edge.type === 'assigned_to') {
        result.push({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: 'rs',
          targetHandle: 'lt',
          className: 'gedge-assigned gedge-deletable',
          style: { stroke: rootGroupColor(graph, edge.to) },
          // Grabbable near an end to re-home (drop on another group) or delete
          // (drop on empty space); the backing edge id drives both.
          reconnectable: true,
          data: { graphEdgeId: edge.id },
        });
      }
    }
    return result;
  }, [graph, analysis, visibleIds]);

  if (layoutGraph(graph).length === 0) {
    return (
      <div className="outliner-empty">
        <p>Nothing to show yet. Add spec items or groups first.</p>
      </div>
    );
  }

  const toggles: { key: FilterKey; label: string; count: number }[] = [
    { key: 'unassigned', label: 'Unassigned work', count: highlight.unassigned.size },
    { key: 'empty', label: 'Empty groups', count: highlight.empty.size },
  ];

  return (
    <div className="graph-wrap">
      <div className="graph-filter">
        {graphMode === 'map' ? (
          <>
            {toggles.map((t) => (
              <button
                key={t.key}
                className={`graph-filter-btn${active[t.key] ? ' graph-filter-btn-active' : ''}`}
                aria-pressed={active[t.key]}
                onClick={() => setActive((a) => ({ ...a, [t.key]: !a[t.key] }))}
              >
                {t.label}
                <span className="graph-filter-count">{t.count}</span>
              </button>
            ))}
            <span className="graph-filter-sep" />
            {(['spotlight', 'hide'] as FilterMode[]).map((m) => (
              <button
                key={m}
                className={`graph-filter-btn${mode === m ? ' graph-filter-btn-active' : ''}`}
                disabled={!anyFilter}
                onClick={() => setMode(m)}
              >
                {m === 'spotlight' ? 'Spotlight' : 'Hide'}
              </button>
            ))}
            <span className="graph-filter-sep" />
            {(
              [
                ['locked', 'Both locked'],
                ['lockSpec', 'Lock Spec'],
                ['lockPlan', 'Lock Plan'],
              ] as [MapSort, string][]
            ).map(([s, label]) => {
              // Lock Spec/Lock Plan re-flow one side to align with its
              // assignments to the other — but Hide mode's visible set is
              // exactly the unassigned work / empty groups, which by
              // definition have no assigned_to edges between them, so there
              // is never anything for either to align with here.
              const inertInHide = s !== 'locked' && hiding;
              return (
                <button
                  key={s}
                  className={`graph-filter-btn${mapSort === s ? ' graph-filter-btn-active' : ''}`}
                  aria-pressed={mapSort === s}
                  disabled={inertInHide}
                  onClick={() => setMapSort(s)}
                  title={
                    inertInHide
                      ? 'Not available in Hide mode — the hidden side has nothing to align with'
                      : s === 'locked'
                        ? 'Each side keeps its own order'
                        : s === 'lockSpec'
                          ? 'Spec order fixed; the plan re-flows to align with it'
                          : 'Plan order fixed; the spec re-flows to align with it'
                  }
                >
                  {label}
                </button>
              );
            })}
          </>
        ) : (
          <button
            className={`graph-filter-btn${inferChains ? ' graph-filter-btn-active' : ''}`}
            aria-pressed={inferChains}
            onClick={() => setInferChains((v) => !v)}
            title="Ghost a sequential chain across sibling stories with no explicit dependency"
          >
            Infer chains
          </button>
        )}
      </div>
      {graphMode === 'map' ? (
        <AuthoringCanvas
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          connectionLineComponent={MapConnectionLine}
          isValidConnection={(c) => resolveAssignmentEnds(c, isGroup) !== null}
          onConnect={onConnect}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onNodeClick={onSelect}
          onPaneClick={() => onSelect(null)}
          reflowSignature={`${mode}:${active.unassigned}:${active.empty}:${mapSort}`}
        />
      ) : (
        <DependencyGraph
          selectedId={selectedId}
          onSelect={onSelect}
          filter={filter}
          inferChains={inferChains}
        />
      )}
    </div>
  );
}
