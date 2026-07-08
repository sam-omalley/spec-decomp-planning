/**
 * Pure resolver for authoring dependencies by handle drag in the Dependency
 * view. The meaning of a connection comes from which side each card
 * contributes, not which end starts the drag: the card giving its **right**
 * handle is the prerequisite (work flows out its right), the card giving its
 * **left** handle is the dependent (work flows into its left). So a left→
 * right and a right→left drag author the same edge. A same-side (l–l / r–r)
 * or self connection is not a left↔right flow and resolves to null.
 *
 * Kept dependency-free (no React / React Flow imports) so it is unit-tested
 * with the domain layer.
 */

export interface DepConnection {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface DepEnds {
  /** The node that depends on the other (contributes its left handle). */
  dependent: string;
  /** The node needed first (contributes its right handle). */
  prerequisite: string;
}

export function resolveDependencyEnds(connection: DepConnection): DepEnds | null {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target || source === target) return null;
  if (sourceHandle === 'l' && targetHandle === 'r') {
    return { dependent: source, prerequisite: target };
  }
  if (sourceHandle === 'r' && targetHandle === 'l') {
    return { dependent: target, prerequisite: source };
  }
  return null;
}

export type HandleState = 'show' | 'hide';

export interface HandleVisibility {
  left: HandleState;
  right: HandleState;
}

/**
 * While a connection is in progress, decide which of a card's two handles to
 * reveal. `fromHandle` is the anchored end — the origin when authoring, the
 * still-attached end when reconnecting an existing arrow. A valid target
 * forms a left↔right flow, so:
 *   - on the *from* card, only the anchored side stays visible (the drag
 *     source; the other side would be a self-link);
 *   - on any *other* card, only the opposite side is a valid target.
 * Returns null when no connection is in progress (handles keep their default
 * hover-reveal behaviour).
 */
export function dragHandleVisibility(
  nodeId: string,
  fromNodeId: string | null | undefined,
  fromHandle: string | null | undefined,
): HandleVisibility | null {
  if (!fromNodeId || (fromHandle !== 'l' && fromHandle !== 'r')) return null;
  const isFrom = nodeId === fromNodeId;
  const leftValid = isFrom ? fromHandle === 'l' : fromHandle === 'r';
  const rightValid = isFrom ? fromHandle === 'r' : fromHandle === 'l';
  return {
    left: leftValid ? 'show' : 'hide',
    right: rightValid ? 'show' : 'hide',
  };
}
