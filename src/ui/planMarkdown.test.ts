import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignToGroup,
  createGroup,
  createNode,
  emptyGraph,
  updateNode,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  DEFAULT_MARKDOWN_OPTIONS,
  projectToMarkdown,
  projectToPlanBlocks,
} from './planMarkdown.ts';

/**
 * Spec:  checkout ─┬─ cart ─── tax
 *                  └─ payments
 *        loose               (a second, unassigned root)
 * Delivery:  block1 ─┬─ design (← cart)
 *                    └─ build  (← payments)
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'checkout', title: 'Checkout', type: 'feature' });
  g = createNode(g, { id: 'cart', title: 'Cart' }, 'checkout');
  g = createNode(g, { id: 'tax', title: 'Tax rules' }, 'cart');
  g = createNode(g, { id: 'payments', title: 'Payments' }, 'checkout');
  g = createNode(g, { id: 'loose', title: 'Loose end' });
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'design', title: 'Design Epic' }, 'block1');
  g = createGroup(g, { id: 'build', title: 'Build Epic' }, 'block1');
  g = assignToGroup(g, 'cart', 'design');
  g = assignToGroup(g, 'payments', 'build');
  return g;
}

const ALL = DEFAULT_MARKDOWN_OPTIONS;

describe('projectToMarkdown', () => {
  it('renders groups as depth headings and members as a bullet list', () => {
    const g = fixture();
    const md = projectToMarkdown(g, { details: false, subItems: false, backlog: false });
    assert.equal(
      md,
      [
        '# Block 1',
        '',
        '## Design Epic',
        '',
        '- **Cart**',
        '',
        '## Build Epic',
        '',
        '- **Payments**',
        '',
      ].join('\n'),
    );
  });

  it('nests spec sub-items under an assigned work item', () => {
    const g = fixture();
    const md = projectToMarkdown(g, { details: false, subItems: true, backlog: false });
    assert.match(md, /- \*\*Cart\*\*\n {2}- \*\*Tax rules\*\*/);
  });

  it('renders single-line details inline and keeps titles verbatim', () => {
    let g = fixture();
    g = updateNode(g, 'cart', { description: 'Use the shared component.' });
    g = updateNode(g, 'design', { description: 'Design phase.' });
    const md = projectToMarkdown(g, { details: true, subItems: false, backlog: false });
    assert.match(md, /## Design Epic\n\nDesign phase\./);
    assert.match(md, /- \*\*Cart\*\* — Use the shared component\./);
  });

  it('renders multi-line details as an indented continuation', () => {
    let g = fixture();
    g = updateNode(g, 'payments', { description: 'Line one.\nLine two.' });
    const md = projectToMarkdown(g, { details: true, subItems: false, backlog: false });
    assert.match(md, /- \*\*Payments\*\*\n {2}Line one\.\n {2}Line two\./);
  });

  it('appends a Backlog section of uncovered work items, pruning covered branches', () => {
    const g = fixture();
    const md = projectToMarkdown(g, ALL);
    const backlog = md.slice(md.indexOf('# Backlog'));
    // checkout is uncovered → shown; cart/payments are assigned (covered)
    // → pruned; tax sits under covered cart → also pruned; loose shown.
    assert.match(backlog, /# Backlog\n\n- \*\*Checkout\*\*\n- \*\*Loose end\*\*/);
    assert.doesNotMatch(backlog, /Cart|Payments|Tax/);
  });

  it('omits the Backlog section when everything is covered or the toggle is off', () => {
    let g = fixture();
    g = assignToGroup(g, 'checkout', 'block1');
    g = assignToGroup(g, 'loose', 'block1');
    assert.doesNotMatch(projectToMarkdown(g, ALL), /# Backlog/);
    assert.doesNotMatch(projectToMarkdown(fixture(), { ...ALL, backlog: false }), /# Backlog/);
  });

  it('orders members by their position in the spec forest', () => {
    let g = emptyGraph();
    g = createNode(g, { id: 'a', title: 'A' });
    g = createNode(g, { id: 'b', title: 'B' });
    g = createNode(g, { id: 'c', title: 'C' });
    g = createGroup(g, { id: 'grp', title: 'Group' });
    // Assign out of spec order; output should still read A, B, C.
    g = assignToGroup(g, 'c', 'grp');
    g = assignToGroup(g, 'a', 'grp');
    g = assignToGroup(g, 'b', 'grp');
    const md = projectToMarkdown(g, { details: false, subItems: false, backlog: false });
    assert.match(md, /- \*\*A\*\*\n- \*\*B\*\*\n- \*\*C\*\*/);
  });

  it('clamps heading depth at h6 for deep group nesting', () => {
    let g = emptyGraph();
    let parent: string | undefined;
    const ids = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];
    for (const id of ids) {
      g = createGroup(g, { id, title: id.toUpperCase() }, parent);
      parent = id;
    }
    const blocks = projectToPlanBlocks(g, ALL);
    const levels = blocks
      .filter((b): b is Extract<typeof b, { kind: 'heading' }> => b.kind === 'heading')
      .map((b) => b.level);
    assert.deepEqual(levels, [1, 2, 3, 4, 5, 6, 6, 6]);
  });

  it('produces empty output for a graph with no groups and backlog off', () => {
    let g = emptyGraph();
    g = createNode(g, { id: 'x', title: 'X' });
    assert.equal(projectToMarkdown(g, { details: true, subItems: true, backlog: false }), '');
  });
});
