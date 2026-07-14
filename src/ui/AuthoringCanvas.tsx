/**
 * Shared React-Flow scaffolding for the two handle-drag authoring canvases
 * (Map assignment authoring in GraphView, dependency authoring in
 * DependencyGraph). Both wrap React Flow with the same pattern: loose
 * connection mode so either handle can start or receive a drag, a
 * `reconnectRadius` wide enough for close-together nodes (#62), grab-near-
 * an-end reconnection wired to move/delete, and a `FitOnReflow` that re-fits
 * the viewport when the layout signature changes (a filter/mode toggle).
 *
 * Each view still supplies its own nodes/edges, node renderer (handle
 * topology and drag-visibility are domain-specific — see `mapAuthoring.ts` /
 * `depAuthoring.ts`), connection-line preview, and connection semantics
 * (`isValidConnection` / `onConnect` / `onReconnect`). This component only
 * factors out the parts that were byte-for-byte identical.
 */

import { useEffect } from 'react';
import type { ComponentType } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  useConnection,
  useReactFlow,
} from '@xyflow/react';
import type {
  Connection,
  ConnectionLineComponentProps,
  Edge as FlowEdge,
  HandleType,
  FinalConnectionState,
  Node as FlowNode,
  NodeTypes,
  OnReconnect,
} from '@xyflow/react';

/** Re-fits the viewport whenever `signature` changes — i.e. when a
 *  filter/mode toggle reflows the graph. Must render inside <ReactFlow> so
 *  it can reach the instance via context. */
export function FitOnReflow({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    void fitView({ duration: 200 });
  }, [signature, fitView]);
  return null;
}

/** Signature of the in-progress connection (empty when idle) — a primitive
 *  so the `useConnection` selector stays referentially stable across
 *  renders. Feed it to a node's handle-visibility resolver. */
export function useConnectionSignature(): string {
  return useConnection((c) =>
    c.inProgress ? `${c.fromNode?.id ?? ''}:${c.fromHandle?.id ?? ''}` : '',
  );
}

/**
 * Builds a connection-line preview component: a dashed line with an
 * arrowhead. The arrow sits at the fixed `from` point when the drag
 * originated from `arrowAtFromHandleId` (so it previews the flow direction
 * correctly regardless of which end the drag started from), otherwise it
 * rides the moving `to` point.
 */
export function makeArrowConnectionLine(options: {
  color: string;
  arrowAtFromHandleId: string;
  strokeWidth?: number;
  dashArray?: string;
}): ComponentType<ConnectionLineComponentProps> {
  const { color, arrowAtFromHandleId, strokeWidth = 1.5, dashArray = '6 4' } = options;
  return function ArrowConnectionLine({ fromX, fromY, toX, toY, fromHandle }) {
    const arrowAtFrom = fromHandle?.id === arrowAtFromHandleId;
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
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
        />
        <path d={arrow} fill={color} />
      </g>
    );
  };
}

interface AuthoringCanvasProps<N extends FlowNode, E extends FlowEdge> {
  nodes: N[];
  edges: E[];
  nodeTypes: NodeTypes;
  connectionLineComponent: ComponentType<ConnectionLineComponentProps>;
  isValidConnection: (connection: Connection | E) => boolean;
  onConnect: (connection: Connection) => void;
  onReconnectStart: () => void;
  onReconnect: OnReconnect<E>;
  onReconnectEnd: (
    event: MouseEvent | TouchEvent,
    edge: E,
    handleType: HandleType,
    connectionState: FinalConnectionState,
  ) => void;
  onNodeClick: (id: string) => void;
  onPaneClick: () => void;
  /** Changes when the layout should re-fit the viewport (filters, mode,
   *  sort — whatever the caller's layout depends on). */
  reflowSignature: string;
}

export function AuthoringCanvas<N extends FlowNode, E extends FlowEdge>({
  nodes,
  edges,
  nodeTypes,
  connectionLineComponent,
  isValidConnection,
  onConnect,
  onReconnectStart,
  onReconnect,
  onReconnectEnd,
  onNodeClick,
  onPaneClick,
  reflowSignature,
}: AuthoringCanvasProps<N, E>) {
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
      connectionLineComponent={connectionLineComponent}
      // Only edges opting in (reconnectable: true) are grabbable; this stops
      // structural/inferred/non-authored edges from being detached.
      edgesReconnectable={false}
      // Wider than the 10px default (#62): with nodes close together a
      // short edge's grabbable end sits right at a node's boundary, and the
      // default radius is too tight to reliably land on.
      reconnectRadius={20}
      isValidConnection={isValidConnection}
      onConnect={onConnect}
      onReconnectStart={onReconnectStart}
      onReconnect={onReconnect}
      onReconnectEnd={onReconnectEnd}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      onPaneClick={onPaneClick}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <FitOnReflow signature={reflowSignature} />
    </ReactFlow>
  );
}
