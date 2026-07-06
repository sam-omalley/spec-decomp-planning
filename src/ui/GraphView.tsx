/**
 * Graph view: the whole graph on one canvas, read-mostly. The spec
 * forest grows left-to-right, the delivery forest is mirrored
 * right-to-left, and dashed 'assigned_to' edges bridge the gap —
 * nested inputs facing nested outputs. Positions come from the pure
 * layout in graphLayout.ts; React Flow only renders.
 *
 * v1 interactions: pan, zoom, click to select (synced with the other
 * views). No dragging, no edge editing. Dependency edges arrive with
 * the Tarjan slice.
 */

import { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from '@xyflow/react';
import type { Edge as FlowEdge, Node as FlowNode, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cycleIndexOf, waitingMap } from '../model/analysis.ts';
import { useProjectGraph } from '../store/appStore.ts';
import { rootGroupColor } from './colors.ts';
import { layoutGraph } from './graphLayout.ts';
import { isEmptyLeafGroup, uncoveredWorkIds } from './planning.ts';

/** Which nodes to spotlight; dims everything else without moving it. */
type GraphFilter = 'none' | 'unassigned' | 'empty';

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

function WorkGraphNode({ data }: NodeProps<GNode>) {
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
  return (
    <div className={classes}>
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="source" position={Position.Right} id="rs" className="ghandle" />
    </div>
  );
}

function GroupGraphNode({ data }: NodeProps<GNode>) {
  const classes = [
    'gnode',
    'gnode-group',
    data.isSelected ? 'gnode-selected' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={{ ['--group-color' as string]: data.color }}>
      <Handle type="source" position={Position.Left} id="ls" className="ghandle" />
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="target" position={Position.Right} id="rt" className="ghandle" />
    </div>
  );
}

const nodeTypes = { work: WorkGraphNode, group: GroupGraphNode };

interface GraphViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function GraphView({ selectedId, onSelect }: GraphViewProps) {
  const graph = useProjectGraph();
  const [filter, setFilter] = useState<GraphFilter>('none');

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

  function matchesFilter(id: string): boolean {
    if (filter === 'unassigned') return highlight.unassigned.has(id);
    if (filter === 'empty') return highlight.empty.has(id);
    return false;
  }

  const nodes = useMemo<GNode[]>(
    () =>
      layoutGraph(graph).map((placed) => {
        const node = graph.nodes[placed.id]!;
        const matched = matchesFilter(placed.id);
        return {
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
            dimmed: filter !== 'none' && !matched,
            matched,
            ...(placed.side === 'group'
              ? { color: rootGroupColor(graph, placed.id) }
              : {}),
          },
          draggable: false,
          connectable: false,
        };
      }),
    [graph, selectedId, analysis, filter, highlight],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const result: FlowEdge[] = [];
    for (const edge of Object.values(graph.edges)) {
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
  }, [graph, analysis]);

  if (nodes.length === 0) {
    return (
      <div className="outliner-empty">
        <p>Nothing to show yet. Add spec items or groups first.</p>
      </div>
    );
  }

  const filters: { key: GraphFilter; label: string; count?: number }[] = [
    { key: 'none', label: 'All' },
    { key: 'unassigned', label: 'Unassigned work', count: highlight.unassigned.size },
    { key: 'empty', label: 'Empty groups', count: highlight.empty.size },
  ];

  return (
    <div className="graph-wrap">
      <div className="graph-filter">
        {filters.map((f) => (
          <button
            key={f.key}
            className={`graph-filter-btn${filter === f.key ? ' graph-filter-btn-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.count !== undefined && <span className="graph-filter-count">{f.count}</span>}
          </button>
        ))}
      </div>
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
      </ReactFlow>
    </div>
  );
}
