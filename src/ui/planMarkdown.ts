/**
 * Renders the delivery plan (the group forest plus its assigned work
 * items) as Markdown. Pure and testable: it builds a small block model
 * once, which serializes to a Markdown string and also renders to React
 * in MarkdownView.
 *
 * Shape: each group is a heading at its depth (root = h1, clamped at
 * h6); the work items assigned to a group are a bullet list under it,
 * with their spec sub-items nested; child groups follow as deeper
 * headings. Titles are used verbatim. An optional trailing Backlog
 * section lists work items not covered by any assignment, so nothing
 * is silently dropped.
 */

import { childrenOf, groupRootsOf, membersOfGroup, rootsOf } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import { coveringGroups } from './planning.ts';

export interface MarkdownOptions {
  /** Render each node's Details (description) text. */
  details: boolean;
  /** Nest an assigned work item's spec children beneath it. */
  subItems: boolean;
  /** Append a Backlog section of unassigned work items. */
  backlog: boolean;
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = {
  details: true,
  subItems: true,
  backlog: true,
};

export interface MdListItem {
  title: string;
  /** Details text, or '' when absent or disabled. */
  detail: string;
  children: MdListItem[];
}

export type MdBlock =
  | { kind: 'heading'; level: number; text: string; detail: string }
  | { kind: 'list'; items: MdListItem[] };

function titleOf(graph: ProjectGraph, id: string): string {
  return graph.nodes[id]?.title.trim() || 'Untitled';
}

function detailOf(graph: ProjectGraph, id: string, options: MarkdownOptions): string {
  return options.details ? (graph.nodes[id]?.description.trim() ?? '') : '';
}

/** Pre-order position of every work node, for stable member ordering. */
function workOrderIndex(graph: ProjectGraph): Map<string, number> {
  const index = new Map<string, number>();
  let counter = 0;
  const visit = (id: string): void => {
    index.set(id, counter++);
    for (const child of childrenOf(graph, id)) visit(child);
  };
  for (const root of rootsOf(graph)) visit(root);
  return index;
}

function workItemToListItem(
  graph: ProjectGraph,
  id: string,
  options: MarkdownOptions,
): MdListItem {
  const children = options.subItems
    ? childrenOf(graph, id).map((child) => workItemToListItem(graph, child, options))
    : [];
  return { title: titleOf(graph, id), detail: detailOf(graph, id, options), children };
}

function collectGroup(
  graph: ProjectGraph,
  groupId: string,
  depth: number,
  order: Map<string, number>,
  options: MarkdownOptions,
  out: MdBlock[],
): void {
  out.push({
    kind: 'heading',
    level: Math.min(depth + 1, 6),
    text: titleOf(graph, groupId),
    detail: detailOf(graph, groupId, options),
  });
  const members = [...membersOfGroup(graph, groupId)].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  );
  if (members.length > 0) {
    out.push({
      kind: 'list',
      items: members.map((m) => workItemToListItem(graph, m, options)),
    });
  }
  for (const child of childrenOf(graph, groupId)) {
    collectGroup(graph, child, depth + 1, order, options, out);
  }
}

/** Uncovered work item (and its uncovered descendants), or null. */
function backlogItem(
  graph: ProjectGraph,
  id: string,
  options: MarkdownOptions,
): MdListItem | null {
  if (coveringGroups(graph, id).length > 0) return null;
  const children: MdListItem[] = [];
  for (const child of childrenOf(graph, id)) {
    const item = backlogItem(graph, child, options);
    if (item) children.push(item);
  }
  return { title: titleOf(graph, id), detail: detailOf(graph, id, options), children };
}

export function projectToPlanBlocks(
  graph: ProjectGraph,
  options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS,
): MdBlock[] {
  const order = workOrderIndex(graph);
  const blocks: MdBlock[] = [];
  for (const root of groupRootsOf(graph)) {
    collectGroup(graph, root, 0, order, options, blocks);
  }
  if (options.backlog) {
    const items: MdListItem[] = [];
    for (const root of rootsOf(graph)) {
      const item = backlogItem(graph, root, options);
      if (item) items.push(item);
    }
    if (items.length > 0) {
      blocks.push({ kind: 'heading', level: 1, text: 'Backlog', detail: '' });
      blocks.push({ kind: 'list', items });
    }
  }
  return blocks;
}

function itemToLines(item: MdListItem, indent: number): string[] {
  const pad = '  '.repeat(indent);
  const inlineDetail = item.detail !== '' && !item.detail.includes('\n');
  const lines = [`${pad}- **${item.title}**${inlineDetail ? ` — ${item.detail}` : ''}`];
  if (item.detail !== '' && !inlineDetail) {
    for (const line of item.detail.split('\n')) lines.push(`${pad}  ${line}`);
  }
  for (const child of item.children) lines.push(...itemToLines(child, indent + 1));
  return lines;
}

export function blocksToMarkdown(blocks: MdBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') {
      parts.push(`${'#'.repeat(block.level)} ${block.text}`);
      if (block.detail !== '') parts.push(block.detail);
    } else {
      parts.push(block.items.flatMap((item) => itemToLines(item, 0)).join('\n'));
    }
  }
  return parts.length === 0 ? '' : parts.join('\n\n') + '\n';
}

export function projectToMarkdown(
  graph: ProjectGraph,
  options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS,
): string {
  return blocksToMarkdown(projectToPlanBlocks(graph, options));
}
