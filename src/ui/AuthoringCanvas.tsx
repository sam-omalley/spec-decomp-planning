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
 * factors out the parts that were byte-for-byte identical, including
 * Escape-to-cancel (#88): pressing Escape while an edge is grabbed for
 * reconnection ends the drag immediately (React Flow has no public "abort",
 * so this replays a mouseup so its own listener tears the gesture down) and
 * suppresses both the re-home (`onReconnect`) and the drop-into-space
 * delete (`onReconnectEnd`) — so the edge snaps back rather than requiring
 * a careful re-drop or an undo.
 */

import { useCallback, useEffect, useRef } from 'react';
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
  // Escape-to-cancel a reconnect drag (#88): `reconnecting` is true only
  // between onReconnectStart and onReconnectEnd; Escape during that window
  // arms `cancelled`, which makes the wrapped onReconnect/onReconnectEnd
  // below no-ops for the rest of this gesture — so wherever the edge is
  // eventually dropped, it lands back exactly where it started. That alone
  // only prevents the *mutation*, though: React Flow's drag only truly ends
  // on a real mouseup (there's no public "abort" call), so without more the
  // dashed preview would keep following the cursor until the mouse button
  // is actually released. To end the gesture immediately, replay a mouseup
  // at the last known pointer position — React Flow's own document-level
  // listener treats it exactly like the real one, tearing down the drag.
  const reconnecting = useRef(false);
  const cancelled = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      lastPointer.current = { x: event.clientX, y: event.clientY };
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !reconnecting.current) return;
      cancelled.current = true;
      const { x, y } = lastPointer.current;
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }),
      );
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleReconnectStart = useCallback(() => {
    reconnecting.current = true;
    cancelled.current = false;
    onReconnectStart();
  }, [onReconnectStart]);

  const handleReconnect: OnReconnect<E> = useCallback(
    (oldEdge, connection) => {
      if (cancelled.current) return;
      onReconnect(oldEdge, connection);
    },
    [onReconnect],
  );

  const handleReconnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      edge: E,
      handleType: HandleType,
      connectionState: FinalConnectionState,
    ) => {
      reconnecting.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        return;
      }
      onReconnectEnd(event, edge, handleType, connectionState);
    },
    [onReconnectEnd],
  );

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
      onReconnectStart={handleReconnectStart}
      onReconnect={handleReconnect}
      onReconnectEnd={handleReconnectEnd}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      onPaneClick={onPaneClick}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <FitOnReflow signature={reflowSignature} />
    </ReactFlow>
  );
}
