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
});
