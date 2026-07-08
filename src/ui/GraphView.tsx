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
 * outright. Assignment is possible here too: drag a spec node onto a
 * group node (single membership, so it moves an existing assignment) —
 * handy for dropping loose work onto an empty group without leaving the
 * canvas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type { Edge as FlowEdge, Node as FlowNode, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cycleIndexOf, waitingMap } from '../model/analysis.ts';
import { assignToGroup } from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { rootGroupColor } from './colors.ts';
import { DependencyGraph } from './DependencyGraph.tsx';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import { layoutGraph } from './graphLayout.ts';
import { isEmptyLeafGroup, uncoveredWorkIds } from './planning.ts';

type FilterKey = 'unassigned' | 'empty';
/** Spotlight dims non-matches in place; hide removes them entirely. */
type FilterMode = 'spotlight' | 'hide';
/** Map = the spec↔plan mirror; Dependency = the leaf-group dep DAG. */
export type GraphMode = 'map' | 'dep';

const DND_TYPE = 'text/plain';

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
  /** Group nodes only: assign the dragged work node to this group. */
  onAssign?: (workId: string) => void;
}

type GNode = FlowNode<GNodeData>;

function WorkGraphNode({ id, data }: NodeProps<GNode>) {
  const classes = [
    'gnode',
    'gnode-work',
    'gnode-draggable',
    data.isSelected ? 'gnode-selected' : '',
    data.isDone ? 'gnode-done' : '',
    data.inCycle ? 'gnode-cycle' : data.isWaiting ? 'gnode-waiting' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      draggable
      title="Drag onto a group to assign"
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="source" position={Position.Right} id="rs" className="ghandle" />
    </div>
  );
}

function GroupGraphNode({ data }: NodeProps<GNode>) {
  const [over, setOver] = useState(false);
  const classes = [
    'gnode',
    'gnode-group',
    data.isSelected ? 'gnode-selected' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
    over ? 'gnode-drop' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      style={{ ['--group-color' as string]: data.color }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const workId = e.dataTransfer.getData(DND_TYPE);
        if (workId) data.onAssign?.(workId);
      }}
    >
      <Handle type="source" position={Position.Left} id="ls" className="ghandle" />
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="target" position={Position.Right} id="rt" className="ghandle" />
    </div>
  );
}

const nodeTypes = { work: WorkGraphNode, group: GroupGraphNode };

/** Re-fits the viewport whenever `signature` changes — i.e. when the
 *  filter/mode toggles reflow the graph. Lives inside <ReactFlow> so it
 *  can reach the instance via context. */
function FitOnReflow({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({ duration: 200 });
  }, [signature, fitView]);
  return null;
}

interface GraphViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Global filter, shared across tabs; dims non-matches in place. */
  filter?: FilterState;
  /** Map vs Dependency mode; lifted so the footer hint can follow it. */
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
}

export function GraphView({
  selectedId,
  onSelect,
  filter = EMPTY_FILTER,
  mode: graphMode,
  onModeChange: setGraphMode,
}: GraphViewProps) {
  const graph = useProjectGraph();
  const [inferChains, setInferChains] = useState(false);
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

  const assign = useCallback(
    (workId: string, groupId: string) => {
      store.commit((g) => {
        const node = g.nodes[workId];
        if (!node || node.type === 'group' || !g.nodes[groupId]) return g;
        return assignToGroup(g, workId, groupId);
      });
      onSelect(workId);
    },
    [onSelect],
  );

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
    for (const placed of layoutGraph(graph, visibleSet)) {
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
          ...(placed.side === 'group'
            ? {
                color: rootGroupColor(graph, placed.id),
                onAssign: (workId: string) => assign(workId, placed.id),
              }
            : {}),
        },
        draggable: false,
        connectable: false,
      });
    }
    return result;
  }, [
    graph,
    selectedId,
    analysis,
    anyFilter,
    mode,
    matches,
    assign,
    visibleSet,
    textActive,
    textMatch,
  ]);

  // Edges to a node hidden in hide mode would dangle, so keep only those
  // whose endpoints are both on the canvas.
  const visibleIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const edges = useMemo<FlowEdge[]>(() => {
    const result: FlowEdge[] = [];
    for (const edge of Object.values(graph.edges)) {
      if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
      if (edge.type === 'depends_on' || edge.type === 'blocks') {
        // Normalize to "dependent → prerequisite"; the arrow points at
        // what is needed first.
        const [dependent, prerequisite] =
          edge.type === 'depends_on' ? [edge.from, edge.to] : [edge.to, edge.from];
        const cycleA = analysis.cycles.get(dependent);
        const inCycle = cycleA !== undefined && cycleA === analysis.cycles.get(prerequisite);
        result.push({
          id: edge.id,
          source: dependent,
          target: prerequisite,
          sourceHandle: 'rs',
          targetHandle: 'lt',
          className: inCycle ? 'gedge-dep gedge-dep-cycle' : 'gedge-dep',
          animated: inCycle,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: inCycle ? '#b42318' : '#b58a2c',
          },
        });
      } else if (edge.type === 'contains') {
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
          className: 'gedge-assigned',
          style: { stroke: rootGroupColor(graph, edge.to) },
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
        {(['map', 'dep'] as GraphMode[]).map((m) => (
          <button
            key={m}
            className={`graph-filter-btn${graphMode === m ? ' graph-filter-btn-active' : ''}`}
            aria-pressed={graphMode === m}
            onClick={() => setGraphMode(m)}
          >
            {m === 'map' ? 'Map' : 'Dependency'}
          </button>
        ))}
        <span className="graph-filter-sep" />
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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <FitOnReflow signature={`${mode}:${active.unassigned}:${active.empty}`} />
        </ReactFlow>
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
