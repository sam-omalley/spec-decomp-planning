import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultSettings } from '../model/graph.ts';
import type { ProjectSettings } from '../model/types.ts';
import { isLocked } from './locks.ts';

function settings(patch: Partial<ProjectSettings>): ProjectSettings {
  return { ...defaultSettings(), ...patch };
}

describe('isLocked', () => {
  it('locks nothing when the side lock depth is 0', () => {
    const s = settings({ specLockDepth: 0, planLockDepth: 0 });
    assert.equal(isLocked(0, 'work', s), false);
    assert.equal(isLocked(3, 'work', s), false);
    assert.equal(isLocked(0, 'group', s), false);
  });

  it('freezes depths 0…N-1 on the spec side', () => {
    const s = settings({ specLockDepth: 2 });
    assert.equal(isLocked(0, 'work', s), true);
    assert.equal(isLocked(1, 'work', s), true);
    assert.equal(isLocked(2, 'work', s), false);
    assert.equal(isLocked(3, 'work', s), false);
  });

  it('reads the plan lock depth for the group side, independently', () => {
    const s = settings({ specLockDepth: 0, planLockDepth: 1 });
    // Group roots are locked; spec is untouched.
    assert.equal(isLocked(0, 'group', s), true);
    assert.equal(isLocked(1, 'group', s), false);
    assert.equal(isLocked(0, 'work', s), false);
  });

  it('clamps the lock to existing levels — an empty side locks nothing', () => {
    const s = settings({ specLockDepth: 2, planLockDepth: 3 });
    // levelCount 0 (no nodes yet): nothing is locked, so the "create first
    // item" affordance stays live.
    assert.equal(isLocked(0, 'work', s, 0), false);
    assert.equal(isLocked(0, 'group', s, 0), false);
  });

  it('clamps a deep lock to a shallow tree, still freezing what exists', () => {
    const s = settings({ specLockDepth: 3 });
    // Roots-only side (one level): the roots freeze, but depth-1 children
    // are addable/unlocked because level 1 does not exist yet.
    assert.equal(isLocked(0, 'work', s, 1), true);
    assert.equal(isLocked(1, 'work', s, 1), false);
  });
});
