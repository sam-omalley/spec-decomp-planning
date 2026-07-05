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

import { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
} from '@xyflow/react';
import type { Edge as FlowEdge, Node as FlowNode, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useProjectGraph } from '../store/appStore.ts';
import { rootGroupColor } from './colors.ts';
import { layoutGraph } from './graphLayout.ts';

interface GNodeData extends Record<string, unknown> {
  title: string;
  hasDetails: boolean;
  isSelected: boolean;
  color?: string;
}

type GNode = FlowNode<GNodeData>;

function WorkGraphNode({ data }: NodeProps<GNode>) {
  return (
    <div className={`gnode gnode-work${data.isSelected ? ' gnode-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="lt" className="ghandle" />
      <span className="gnode-title">{data.title.trim() || 'Untitled'}</span>
      {data.hasDetails && <span className="gnode-details">≡</span>}
      <Handle type="source" position={Position.Right} id="rs" className="ghandle" />
    </div>
  );
}

function GroupGraphNode({ data }: NodeProps<GNode>) {
  return (
    <div
      className={`gnode gnode-group${data.isSelected ? ' gnode-selected' : ''}`}
      style={{ ['--group-color' as string]: data.color }}
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

interface GraphViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function GraphView({ selectedId, onSelect }: GraphViewProps) {
  const graph = useProjectGraph();

  const nodes = useMemo<GNode[]>(
    () =>
      layoutGraph(graph).map((placed) => {
        const node = graph.nodes[placed.id]!;
        return {
          id: placed.id,
          type: placed.side,
          position: { x: placed.x, y: placed.y },
          data: {
            title: node.title,
            hasDetails: node.description.trim() !== '',
            isSelected: placed.id === selectedId,
            ...(placed.side === 'group'
              ? { color: rootGroupColor(graph, placed.id) }
              : {}),
          },
          draggable: false,
          connectable: false,
        };
      }),
    [graph, selectedId],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const result: FlowEdge[] = [];
    for (const edge of Object.values(graph.edges)) {
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
          className: 'gedge-assigned',
          style: { stroke: rootGroupColor(graph, edge.to) },
        });
      }
    }
    return result;
  }, [graph]);

  if (nodes.length === 0) {
    return (
      <div className="outliner-empty">
        <p>Nothing to show yet. Add spec items or groups first.</p>
      </div>
    );
  }

  return (
    <div className="graph-wrap">
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
