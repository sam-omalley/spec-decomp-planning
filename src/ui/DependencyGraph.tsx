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
 * r–r) or self connection is rejected. While a connection is in progress only
 * the valid (opposite-side) handle shows on each card; the other is hidden.
 * The in-progress line carries an arrow that always points at the left handle,
 * previewing the flow.
 *
 * Removing/moving a dependency is by grabbing the arrow near one end
 * (reconnection): the grabbed end detaches and drags while the other stays
 * anchored — drop it on a valid handle to re-home the dependency, or on empty
 * space to delete it. Only real, directly-authored edges are grabbable;
 * inferred (dashed) and container-fanned edges are not.
 *
 * Real dependency edges are solid; the ghosted sequential-chain inference
 * (dep-free siblings) is dashed and muted. Cycles are red + animated,
 * reusing the Map view's convention. The global text filter dims
 * non-matches in place so structure stays legible.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useConnection,
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
import { dragHandleVisibility, resolveDependencyEnds } from './depAuthoring.ts';
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

function DepGraphNode({ id, data }: NodeProps<DepFlowNode>) {
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
  //
  // While a connection is in progress (authoring, or reconnecting an existing
  // arrow), reveal only the handle that would form a valid left↔right flow and
  // hide the other, so a card near the pointer offers one unambiguous target.
  // `fromHandle` is the anchored end — the origin when authoring, the
  // still-attached end when reconnecting; the valid target is the opposite
  // side on any *other* card, and the anchored side only on the from-card.
  // Signature of the in-progress connection (empty when idle) — a primitive so
  // the selector stays referentially stable across renders.
  const conn = useConnection((c) =>
    c.inProgress ? `${c.fromNode?.id ?? ''}:${c.fromHandle?.id ?? ''}` : '',
  );
  let leftDrag = '';
  let rightDrag = '';
  if (conn) {
    const sep = conn.indexOf(':');
    const vis = dragHandleVisibility(id, conn.slice(0, sep), conn.slice(sep + 1));
    if (vis) {
      leftDrag = vis.left === 'show' ? 'dephandle-drag-show' : 'dephandle-drag-hide';
      rightDrag = vis.right === 'show' ? 'dephandle-drag-show' : 'dephandle-drag-hide';
    }
  }
  return (
    <div className={classes} style={{ ['--group-color' as string]: data.color }}>
      <Handle
        type="source"
        position={Position.Left}
        id="l"
        className={`ghandle dephandle ${leftDrag}`}
      />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        className={`ghandle dephandle ${rightDrag}`}
      />
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
          // Only a real, directly-authored edge can be grabbed and reconnected
          // (or dragged off to delete); inferred/fan-out edges have no single
          // backing edge to pick up.
          reconnectable: backing ? true : false,
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

  // Reconnection = "grab the arrow near one end". React Flow detaches the
  // grabbed end and drags it while the other stays anchored. Dropping it on a
  // valid handle re-homes the dependency (remove old + add new, atomically);
  // dropping it on empty space (or an invalid handle) means it was picked up
  // and not put back — so the edge is deleted. `reconnected` tracks whether a
  // valid drop landed, distinguishing the two in `onReconnectEnd`.
  const reconnected = useRef(false);

  function onReconnectStart() {
    reconnected.current = false;
  }

  function onReconnect(oldEdge: FlowEdge<DepEdgeData>, connection: Connection) {
    const graphEdgeId = oldEdge.data?.graphEdgeId;
    const ends = resolveDependencyEnds(connection);
    if (!graphEdgeId || !ends) return; // invalid drop → let onReconnectEnd delete
    reconnected.current = true;
    const { dependent, prerequisite } = ends;
    store.commit((g) => {
      let next = g.edges[graphEdgeId] ? removeEdge(g, graphEdgeId) : g;
      if (!next.nodes[dependent] || !next.nodes[prerequisite]) return next;
      if (edgeBetween(next, 'depends_on', dependent, prerequisite)) return next;
      return addEdge(next, { type: 'depends_on', from: dependent, to: prerequisite });
    });
    onSelect(dependent);
  }

  function onReconnectEnd(_: unknown, edge: FlowEdge<DepEdgeData>) {
    if (reconnected.current) return; // already re-homed in onReconnect
    const graphEdgeId = edge.data?.graphEdgeId;
    if (!graphEdgeId) return;
    store.commit((g) => (g.edges[graphEdgeId] ? removeEdge(g, graphEdgeId) : g));
  }

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
      onReconnectStart={onReconnectStart}
      onReconnect={onReconnect}
      onReconnectEnd={onReconnectEnd}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <FitOnReflow signature={`${inferChains}`} />
    </ReactFlow>
  );
}
