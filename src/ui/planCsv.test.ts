import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addExternalRef,
  addResource,
  assignResource,
  createGroup,
  emptyGraph,
  setActualDates,
  setEstimate,
  updateNode,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import { projectToCsv, projectToPlanCsvRows, rowsToCsv } from './planCsv.ts';

/** block1 ─┬─ design (own effort 3, resource "Ada")
 *          └─ build  (no own effort, has children — a rollup gap by design)
 *              └─ subtask (own duration 2, actuals, a jira key)
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = addResource(g, { id: 'ada', name: 'Ada' });
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'design', title: 'Design Epic' }, 'block1');
  g = createGroup(g, { id: 'build', title: 'Build Epic' }, 'block1');
  g = createGroup(g, { id: 'subtask', title: 'Subtask' }, 'build');
  g = setEstimate(g, 'design', { effort: 3 });
  g = assignResource(g, 'design', 'ada');
  g = setEstimate(g, 'subtask', { durationEstimate: 2 });
  g = setActualDates(g, 'subtask', { actualStart: '2026-01-05', actualFinish: '2026-01-07' });
  g = addExternalRef(g, 'subtask', { system: 'jira', key: 'PT-1' });
  return g;
}

describe('projectToPlanCsvRows', () => {
  it('lists every group in pre-order with depth', () => {
    const rows = projectToPlanCsvRows(fixture());
    assert.deepEqual(
      rows.map((r) => [r.title, r.depth]),
      [
        ['Block 1', 0],
        ['Design Epic', 1],
        ['Build Epic', 1],
        ['Subtask', 2],
      ],
    );
  });

  it('exports the own estimate only — an unestimated container with children is a blank, not a rolled sum', () => {
    const rows = projectToPlanCsvRows(fixture());
    const build = rows.find((r) => r.title === 'Build Epic')!;
    assert.equal(build.effort, null);
    assert.equal(build.durationEstimate, null);
    const design = rows.find((r) => r.title === 'Design Epic')!;
    assert.equal(design.effort, 3);
  });

  it('resolves resourceId to the resource name, and blanks a dangling id', () => {
    let g = fixture();
    g = updateNode(g, 'build', { resourceId: 'no-such-resource' });
    const rows = projectToPlanCsvRows(g);
    assert.equal(rows.find((r) => r.title === 'Design Epic')!.resource, 'Ada');
    assert.equal(rows.find((r) => r.title === 'Build Epic')!.resource, '');
  });

  it('carries actual dates through untouched', () => {
    const rows = projectToPlanCsvRows(fixture());
    const subtask = rows.find((r) => r.title === 'Subtask')!;
    assert.equal(subtask.actualStart, '2026-01-05');
    assert.equal(subtask.actualFinish, '2026-01-07');
  });

  it('renders a jira key bare and a non-jira system prefixed', () => {
    let g = fixture();
    g = addExternalRef(g, 'subtask', { system: 'github', key: '42' });
    const rows = projectToPlanCsvRows(g);
    assert.equal(rows.find((r) => r.title === 'Subtask')!.keys, 'PT-1; github:42');
  });
});

describe('rowsToCsv', () => {
  it('emits a header row and indents nested titles', () => {
    const csv = rowsToCsv(projectToPlanCsvRows(fixture()));
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], 'Title,Status,Priority,Resource,Points,Days,Start,Finish,Keys');
    assert.equal(lines[1], 'Block 1,not started,medium,,,,,,');
    assert.equal(lines[2], '  Design Epic,not started,medium,Ada,3,,,,');
    assert.equal(lines[4], '    Subtask,done,medium,,,2,2026-01-05,2026-01-07,PT-1');
  });

  it('quotes a title containing a comma or quote, doubling internal quotes', () => {
    let g = fixture();
    g = updateNode(g, 'block1', { title: 'Block, "one"' });
    const csv = rowsToCsv(projectToPlanCsvRows(g));
    const blockLine = csv.trim().split('\r\n')[1]!;
    assert.match(blockLine, /^"Block, ""one"""/);
  });
});

describe('projectToCsv', () => {
  it('composes row-building and serialization', () => {
    const g = fixture();
    assert.equal(projectToCsv(g), rowsToCsv(projectToPlanCsvRows(g)));
  });
});
