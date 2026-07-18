/**
 * Coverage view: the symmetric counterpart to Concerns for the spec side —
 * which requirements no group addresses at all, at any depth. Derived from
 * the same coverage logic the spec pane's tags use (`uncoveredForest`,
 * `planning.ts`), rendered as a nested list (an uncovered subtree can still
 * contain a covered "island" — a descendant with its own direct
 * assignment — so the shape matters, unlike Concerns' flat rows).
 */

import { useMemo } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import { uncoveredForest, type UncoveredNode } from './planning.ts';

interface CoverageViewProps {
  /** Jump to a work node's definition in the spec outliner. */
  onReveal?: (id: string) => void;
}

interface Row {
  id: string;
  depth: number;
}

function flatten(nodes: UncoveredNode[], depth: number, out: Row[]): void {
  for (const node of nodes) {
    out.push({ id: node.id, depth });
    flatten(node.children, depth + 1, out);
  }
}

export function CoverageView({ onReveal }: CoverageViewProps = {}) {
  const graph = useProjectGraph();
  const forest = useMemo(() => uncoveredForest(graph), [graph]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    flatten(forest, 0, out);
    return out;
  }, [forest]);

  if (forest.length === 0) {
    return (
      <div className="concerns-empty">
        <p className="concerns-clear">✓ Full coverage</p>
        <p className="metric-hint">
          Every spec item is addressed by a group, directly or via an
          ancestor. Uncovered items surface here as the spec grows ahead of
          the plan.
        </p>
      </div>
    );
  }

  return (
    <div className="concerns-wrap">
      <p className="metric-hint">
        {rows.length} spec item{rows.length === 1 ? '' : 's'} not addressed by
        any plan group.
      </p>
      <ul className="coverage-list">
        {rows.map((row) => {
          const node = graph.nodes[row.id];
          const clickable = Boolean(onReveal);
          return (
            <li
              key={row.id}
              className={`coverage-row${clickable ? ' coverage-row-link' : ''}`}
              style={{ paddingLeft: row.depth * 16 + 8 }}
              onClick={clickable ? () => onReveal!(row.id) : undefined}
              title={clickable ? 'Open in the spec outliner' : undefined}
            >
              {node?.title.trim() || 'Untitled'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
