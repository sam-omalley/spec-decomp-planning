/**
 * Dependency view (Graph tab, Dependency mode): the plan's leaf groups —
 * the "stories" — laid out by the dependency relation, prerequisites left,
 * dependents right. Positions come from the pure `depLayout.ts`; React Flow
 * only renders. Arrows follow the **flow of work** left→right: they point
 * from a prerequisite's right side into its dependent's left side, i.e. at
 * the dependent (not backwards at the prerequisite).
 *
 * Authoring is by handle drag, deliberately not node-onto-node drag (that
 * fought the pan gesture). What a card *contributes* fixes the meaning, not
 * which end starts the drag: the card giving its **right** handle is the
 * prerequisite, the card giving its **left** handle is the dependent — so
 * left→right or right→left both author the same edge. A same-side (l–l or
 * r–r) or self connection is rejected. The in-progress line carries an
 * arrow that always points at the left handle, previewing the flow.
 * Clicking a real, directly-authored edge removes it (after confirm);
 * inferred (dashed) and container-fanned edges are not click-deletable.
 *
 * Real dependency edges are solid; the ghosted sequential-chain inference
 * (dep-free siblings) is dashed and muted. Cycles are red + animated,
 * reusing the Map view's convention. The global text filter dims
 * non-matches in place so structure stays legible.
 */

import { useEffect, useMemo } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type {
  Connection,
  ConnectionLineComponentProps,
  Edge as FlowEdge,
  Node as FlowNode,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { addEdge, edgeBetween, removeEdge } from '../model/graph.ts';
import { store, useProjectGraph } from '../store/appStore.ts';
import { resolveDependencyEnds } from './depAuthoring.ts';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type FilterState } from './filter.ts';
import { layoutDependencies } from './depLayout.ts';

const EDGE_COLOR = '#b58a2c';

interface DepNodeData extends Record<string, unknown> {
  title: string;
  color: string;
  isSelected: boolean;
  isDone: boolean;
  inCycle: boolean;
  dimmed: boolean;
  matched: boolean;
}

type DepFlowNode = FlowNode<DepNodeData>;
/** graphEdgeId is set only on real, directly-authored (deletable) edges. */
interface DepEdgeData extends Record<string, unknown> {
  graphEdgeId?: string;
}

function DepGraphNode({ data }: NodeProps<DepFlowNode>) {
  const classes = [
    'gnode',
    'gnode-group',
    data.isSelected ? 'gnode-selected' : '',
    data.isDone ? 'gnode-done' : '',
    data.inCycle ? 'gnode-cycle' : '',
    data.dimmed ? 'gnode-dim' : '',
    data.matched ? 'gnode-match' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Loose connection mode: both handles are sources, so a drag can start
  // from or land on either side. Which side a card contributes decides the
  // relationship — right = prerequisite (work flows out), left = dependent.
  return (
    <div className={classes} style={{ ['--group-color' as string]: data.color }}>
      <Handle type="source" position={Position.Left} id="l" className="ghandle dephandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      <Handle type="source" position={Position.Right} id="r" className="ghandle dephandle" />
    </div>
  );
}

const nodeTypes = { dep: DepGraphNode };

/** The in-progress connection line: a dashed flow line whose arrow always
 *  points at the left handle (the dependent side), previewing the edge. */
function DepConnectionLine({ fromX, fromY, toX, toY, fromHandle }: ConnectionLineComponentProps) {
  // Grab a left handle → the arrow sits at that fixed start; grab a right
  // handle → the arrow rides the moving end, toward the dependent's left.
  const arrowAtFrom = fromHandle?.id === 'l';
  const tipX = arrowAtFrom ? fromX : toX;
  const tipY = arrowAtFrom ? fromY : toY;
  const baseX = arrowAtFrom ? toX : fromX;
  const baseY = arrowAtFrom ? toY : fromY;
  const dx = tipX - baseX;
  const dy = tipY - baseY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 9;
  const half = 5.5;
  const backX = tipX - ux * size;
  const backY = tipY - uy * size;
  const arrow = `M ${tipX} ${tipY} L ${backX - uy * half} ${backY + ux * half} L ${backX + uy * half} ${backY - ux * half} Z`;
  return (
    <g>
      <path
        d={`M ${fromX} ${fromY} L ${toX} ${toY}`}
        fill="none"
        stroke={EDGE_COLOR}
        strokeWidth={2}
        strokeDasharray="5 4"
      />
      <path d={arrow} fill={EDGE_COLOR} />
    </g>
  );
}

/** Re-fit when the layout signature changes (the infer-chains toggle). */
function FitOnReflow({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({ duration: 200 });
  }, [signature, fitView]);
  return null;
}

interface DependencyGraphProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter?: FilterState;
  /** Ghost a sequential chain across dep-free sibling leaves. */
  inferChains: boolean;
}

export function DependencyGraph({
  selectedId,
  onSelect,
  filter = EMPTY_FILTER,
  inferChains,
}: DependencyGraphProps) {
  const graph = useProjectGraph();
  const layout = useMemo(
    () => layoutDependencies(graph, { inferChains }),
    [graph, inferChains],
  );

  const textActive = isFilterActive(filter);
  const textMatch = useMemo(() => {
    const set = new Set<string>();
    if (textActive) {
      for (const n of layout.nodes) {
        const node = graph.nodes[n.id];
        if (node && matchesFilter(node, filter)) set.add(n.id);
      }
    }
    return set;
  }, [textActive, layout.nodes, graph, filter]);

  const nodes = useMemo<DepFlowNode[]>(
    () =>
      layout.nodes.map((n) => {
        const node = graph.nodes[n.id]!;
        return {
          id: n.id,
          type: 'dep',
          position: { x: n.x, y: n.y },
          data: {
            title: node.title,
            color: n.color,
            isSelected: n.id === selectedId,
            isDone: node.status === 'done',
            inCycle: n.cycle !== null,
            dimmed: textActive && !textMatch.has(n.id),
            matched: textActive && textMatch.has(n.id),
          },
          draggable: false,
          connectable: true,
        };
      }),
    [layout.nodes, graph, selectedId, textActive, textMatch],
  );

  const edges = useMemo<FlowEdge<DepEdgeData>[]>(
    () =>
      layout.edges.map((e, i) => {
        // A real edge is directly deletable only when a single backing
        // graph edge connects exactly these two leaves (not a container
        // fan-out and not an inference).
        const backing = e.inferred
          ? undefined
          : (edgeBetween(graph, 'depends_on', e.dependent, e.prerequisite) ??
            edgeBetween(graph, 'blocks', e.prerequisite, e.dependent));
        const className = [
          'gedge-dep',
          e.inCycle ? 'gedge-dep-cycle' : '',
          e.inferred ? 'gedge-dep-inferred' : '',
          backing ? 'gedge-deletable' : '',
        ]
          .filter(Boolean)
          .join(' ');
        // Draw with the flow: prerequisite's right → dependent's left, so
        // the arrowhead lands on the dependent (work flows left→right).
        return {
          id: `${e.prerequisite} ${e.dependent} ${i}`,
          source: e.prerequisite,
          target: e.dependent,
          sourceHandle: 'r',
          targetHandle: 'l',
          className,
          animated: e.inCycle,
          data: { graphEdgeId: backing?.id },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: e.inCycle ? '#b42318' : e.inferred ? '#9aa0a6' : EDGE_COLOR,
          },
        };
      }),
    [layout.edges, graph],
  );

  function onConnect(connection: Connection) {
    const ends = resolveDependencyEnds(connection);
    if (!ends) return;
    const { dependent, prerequisite } = ends;
    store.commit((g) => {
      if (!g.nodes[dependent] || !g.nodes[prerequisite]) return g;
      if (edgeBetween(g, 'depends_on', dependent, prerequisite)) return g;
      return addEdge(g, { type: 'depends_on', from: dependent, to: prerequisite });
    });
    onSelect(dependent);
  }

  function isValidConnection(connection: Connection | FlowEdge): boolean {
    return resolveDependencyEnds(connection) !== null;
  }

  function onEdgeClick(_: unknown, edge: FlowEdge<DepEdgeData>) {
    const graphEdgeId = edge.data?.graphEdgeId;
    if (!graphEdgeId) return; // inferred or container-fanned: nothing single to remove
    // source = prerequisite, target = dependent (drawn with the flow).
    const prq = graph.nodes[edge.source]?.title.trim() || 'Untitled';
    const dep = graph.nodes[edge.target]?.title.trim() || 'Untitled';
    if (!window.confirm(`Remove dependency: “${dep}” depends on “${prq}”?`)) return;
    store.commit((g) => (g.edges[graphEdgeId] ? removeEdge(g, graphEdgeId) : g));
  }

  if (layout.nodes.length === 0) {
    return (
      <div className="outliner-empty">
        <p>No leaf groups yet. Add stories to the plan to sequence them here.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      nodesDraggable={false}
      nodesConnectable
      elementsSelectable={false}
      connectionMode={ConnectionMode.Loose}
      connectionLineComponent={DepConnectionLine}
      isValidConnection={isValidConnection}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <FitOnReflow signature={`${inferChains}`} />
    </ReactFlow>
  );
}
