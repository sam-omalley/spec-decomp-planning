/**
 * Structural-lock predicate. A side's top `lockDepth` levels are frozen
 * against accidental edits: rename, reorder, indent/outdent, delete, and
 * creating siblings at the locked level. Roots are depth 0, so a lock depth
 * of N freezes depths 0…N-1 (N = 0 ⇒ nothing locked).
 *
 * This is a UI-level guard, not a graph invariant — it gates the editing
 * affordances only. The core mutations in `graph.ts` stay unchanged, so
 * import, undo, and programmatic paths ignore locks entirely.
 *
 * The lock freezes shape + naming only: new children below the deepest
 * locked level are unlocked, assignment onto/off a locked group stays
 * allowed, and a locked group's plan meta (status, estimate, dates, deps,
 * refs) remains editable.
 *
 * The effective lock depth is clamped to the levels that actually exist
 * (`levelCount` = the side's `treeDepth`): you cannot freeze a level that
 * has no nodes yet. So an empty side locks nothing — the "add the first
 * item" button stays live — and a roots-only side with a deeper configured
 * lock still freezes its roots but lets you add children. Callers that
 * don't pass `levelCount` get the unclamped behaviour (no existing test or
 * path relies on the phantom-level lock).
 */

import type { ProjectSettings } from '../model/types.ts';
import type { OutlineSide } from './outline.ts';

export function isLocked(
  depth: number,
  side: OutlineSide,
  settings: ProjectSettings,
  levelCount = Infinity,
): boolean {
  const configured = side === 'group' ? settings.planLockDepth : settings.specLockDepth;
  const effective = Math.min(configured, levelCount);
  return depth < effective;
}
