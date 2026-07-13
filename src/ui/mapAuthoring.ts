/**
 * Pure resolver for authoring assignments by handle drag in the Map view —
 * the spec↔plan mirror. Mirrors `depAuthoring.ts`, but a Map connection
 * bridges the two *sides*: a work (spec) node's **right** handle (`rs`) and a
 * group (plan) node's **left** target handle (`lt`). Loose connection mode
 * lets either end start the drag, so a work→group and a group→work drag author
 * the same `assigned_to` edge (work → group). Anything else — same side, same
 * type, or a non-assignment handle — resolves to null.
 *
 * Dependency-free (no React / React Flow) so it is unit-tested with the domain
 * layer. `isGroup` tells the two node types apart.
 */

export interface MapConnection {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface AssignEnds {
  /** The spec (work) node being assigned. */
  workId: string;
  /** The plan (group) node it is assigned to. */
  groupId: string;
}

/** Handle ids that start/end an assignment drag: work-right and group-left. */
const WORK_HANDLE = 'rs';
const GROUP_HANDLE = 'lt';

export function resolveAssignmentEnds(
  connection: MapConnection,
  isGroup: (id: string) => boolean,
): AssignEnds | null {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target || source === target) return null;
  const srcGroup = isGroup(source);
  const tgtGroup = isGroup(target);
  // Assignment bridges the two sides — exactly one end is a group.
  if (srcGroup === tgtGroup) return null;
  const workId = srcGroup ? target : source;
  const workHandle = srcGroup ? targetHandle : sourceHandle;
  const groupId = srcGroup ? source : target;
  const groupHandle = srcGroup ? sourceHandle : targetHandle;
  if (workHandle === WORK_HANDLE && groupHandle === GROUP_HANDLE) {
    return { workId, groupId };
  }
  return null;
}

export type HandleState = 'show' | 'hide';

/**
 * While an assignment drag is in progress, decide whether to reveal a card's
 * assignment handle (work → right, group → left). The valid target is the
 * *opposite* side, so: the from-card keeps its anchored handle; every other
 * card of the opposite type shows its handle; same-type cards hide it. Returns
 * null when no assignment drag is in progress (default hover behaviour).
 */
export function assignmentHandleVisibility(
  nodeId: string,
  nodeIsGroup: boolean,
  fromNodeId: string | null | undefined,
  fromHandle: string | null | undefined,
): HandleState | null {
  if (!fromNodeId || (fromHandle !== WORK_HANDLE && fromHandle !== GROUP_HANDLE)) return null;
  const fromIsGroup = fromHandle === GROUP_HANDLE;
  if (nodeId === fromNodeId) return 'show';
  return nodeIsGroup !== fromIsGroup ? 'show' : 'hide';
}
