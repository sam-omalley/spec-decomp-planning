import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentHandleVisibility, resolveAssignmentEnds } from './mapAuthoring.ts';

// Groups are g*, work nodes are w*.
const isGroup = (id: string) => id.startsWith('g');

describe('resolveAssignmentEnds', () => {
  it('resolves work-right → group-left to an assignment', () => {
    assert.deepEqual(
      resolveAssignmentEnds(
        { source: 'w1', sourceHandle: 'rs', target: 'g1', targetHandle: 'lt' },
        isGroup,
      ),
      { workId: 'w1', groupId: 'g1' },
    );
  });

  it('resolves the loose reverse (group-left → work-right) the same way', () => {
    assert.deepEqual(
      resolveAssignmentEnds(
        { source: 'g1', sourceHandle: 'lt', target: 'w1', targetHandle: 'rs' },
        isGroup,
      ),
      { workId: 'w1', groupId: 'g1' },
    );
  });

  it('rejects a work→work connection (both same side)', () => {
    assert.equal(
      resolveAssignmentEnds(
        { source: 'w1', sourceHandle: 'rs', target: 'w2', targetHandle: 'lt' },
        isGroup,
      ),
      null,
    );
  });

  it('rejects a group→group connection', () => {
    assert.equal(
      resolveAssignmentEnds(
        { source: 'g1', sourceHandle: 'lt', target: 'g2', targetHandle: 'lt' },
        isGroup,
      ),
      null,
    );
  });

  it('rejects the wrong handles (work-left / group-right)', () => {
    // work's LEFT handle is the contains target, not an assignment source
    assert.equal(
      resolveAssignmentEnds(
        { source: 'w1', sourceHandle: 'lt', target: 'g1', targetHandle: 'lt' },
        isGroup,
      ),
      null,
    );
    // group's RIGHT handle is contains, not the assignment target
    assert.equal(
      resolveAssignmentEnds(
        { source: 'w1', sourceHandle: 'rs', target: 'g1', targetHandle: 'rt' },
        isGroup,
      ),
      null,
    );
  });

  it('rejects self / missing endpoints', () => {
    assert.equal(
      resolveAssignmentEnds({ source: 'w1', sourceHandle: 'rs', target: 'w1', targetHandle: 'lt' }, isGroup),
      null,
    );
    assert.equal(resolveAssignmentEnds({ source: 'w1', sourceHandle: 'rs' }, isGroup), null);
  });
});

describe('assignmentHandleVisibility', () => {
  it('returns null when no assignment drag is in progress', () => {
    assert.equal(assignmentHandleVisibility('w1', false, null, null), null);
    // a drag from a non-assignment handle (e.g. contains) is not ours
    assert.equal(assignmentHandleVisibility('w1', false, 'w2', 'ls'), null);
  });

  it('keeps the from-card handle shown', () => {
    assert.equal(assignmentHandleVisibility('w1', false, 'w1', 'rs'), 'show');
    assert.equal(assignmentHandleVisibility('g1', true, 'g1', 'lt'), 'show');
  });

  it('shows the opposite type and hides the same type while dragging from work', () => {
    // dragging from work w1's right handle
    assert.equal(assignmentHandleVisibility('g1', true, 'w1', 'rs'), 'show'); // group is valid target
    assert.equal(assignmentHandleVisibility('w2', false, 'w1', 'rs'), 'hide'); // another work is not
  });

  it('shows the opposite type and hides the same type while dragging from group', () => {
    assert.equal(assignmentHandleVisibility('w1', false, 'g1', 'lt'), 'show'); // work is valid target
    assert.equal(assignmentHandleVisibility('g2', true, 'g1', 'lt'), 'hide'); // another group is not
  });
});
