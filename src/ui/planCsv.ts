/**
 * Renders the delivery plan (group tree) as CSV, one row per group in
 * pre-order — the same shape `PlanTable` renders, minus its two computed
 * indicators (rolled totals, the waiting/cycle badge) which aren't raw
 * data. Pure and testable, split the same way `planMarkdown.ts` is: a row
 * model (`projectToPlanCsvRows`) that also could drive a future UI, then a
 * separate string serializer (`rowsToCsv`).
 */

import type { Priority, ProjectGraph, Status } from '../model/types.ts';
import { visibleRows } from './outline.ts';

const DEFAULT_SYSTEM = 'jira';

export interface PlanCsvRow {
  title: string;
  /** 0 = root; used to indent the Title column so the exported hierarchy
   *  reads the same as the table without a separate column. */
  depth: number;
  status: Status;
  priority: Priority;
  /** Resolved resource name; '' when unassigned or the id is dangling. */
  resource: string;
  effort: number | null;
  durationEstimate: number | null;
  actualStart: string | null;
  actualFinish: string | null;
  /** External refs joined "; ", each `key` alone for the default (jira)
   *  system, else `system:key` — same convention as the Keys chip. */
  keys: string;
}

/** One row per group, pre-order, ignoring the outliner's collapse state
 *  (a CSV export always has everything). */
export function projectToPlanCsvRows(graph: ProjectGraph): PlanCsvRow[] {
  const resourceNames = new Map(graph.settings.resources.map((r) => [r.id, r.name]));
  return visibleRows(graph, new Set(), 'group').map((row) => {
    const node = graph.nodes[row.id]!;
    return {
      title: node.title,
      depth: row.depth,
      status: node.status,
      priority: node.priority,
      resource: (node.resourceId && resourceNames.get(node.resourceId)) || '',
      effort: node.effort,
      durationEstimate: node.durationEstimate,
      actualStart: node.actualStart,
      actualFinish: node.actualFinish,
      keys: node.externalRefs
        .map((ref) => (ref.system === DEFAULT_SYSTEM ? ref.key : `${ref.system}:${ref.key}`))
        .join('; '),
    };
  });
}

/** Quotes a field only when it contains a comma, quote, or newline. */
function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

const HEADER = [
  'Title',
  'Status',
  'Priority',
  'Resource',
  'Points',
  'Days',
  'Start',
  'Finish',
  'Keys',
];

export function rowsToCsv(rows: PlanCsvRow[]): string {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        `${'  '.repeat(row.depth)}${row.title}`,
        row.status.replace('_', ' '),
        row.priority,
        row.resource,
        row.effort ?? '',
        row.durationEstimate ?? '',
        row.actualStart ?? '',
        row.actualFinish ?? '',
        row.keys,
      ]
        .map((field) => csvEscape(String(field)))
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export function projectToCsv(graph: ProjectGraph): string {
  return rowsToCsv(projectToPlanCsvRows(graph));
}
