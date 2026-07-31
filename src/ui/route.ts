/**
 * URL ⇄ view mapping, pure. The app's navigation state (which section and
 * sub-view) is mirrored into the location hash so browser back/forward,
 * refresh and the "jump to" (reveal) action behave as expected. Hash routing
 * (not path) so it works on static hosting (GitHub Pages) with no rewrites.
 *
 * Hash form: `#/<section>` or `#/<section>/<sub>`, e.g. `#/reporting/metrics`.
 */

import type { GraphMode } from './GraphView.tsx';

export type Section = 'spec' | 'planning' | 'graph' | 'reporting' | 'engagement' | 'settings';
export type PlanMode = 'outline' | 'table' | 'markdown';
export type ReportMode = 'timeline' | 'metrics' | 'assignees' | 'concerns' | 'coverage';
/** Engagement tracker sub-views (#163): the meeting agenda, everything
 *  outstanding across every forum, the comms log, and the roster of people
 *  and forums behind them. */
export type EngagementMode = 'agenda' | 'actions' | 'log' | 'people';
export type { GraphMode };

/** The full navigation state the URL encodes. */
export interface RouteState {
  section: Section;
  planMode: PlanMode;
  graphMode: GraphMode;
  reportMode: ReportMode;
  engagementMode: EngagementMode;
}

/** A section plus (when valid) the one sub-view that section owns. */
export interface RoutePatch {
  section: Section;
  planMode?: PlanMode;
  graphMode?: GraphMode;
  reportMode?: ReportMode;
  engagementMode?: EngagementMode;
}

const SECTIONS: readonly Section[] = [
  'spec',
  'planning',
  'graph',
  'reporting',
  'engagement',
  'settings',
];
const PLAN_MODES: readonly PlanMode[] = ['outline', 'table', 'markdown'];
const GRAPH_MODES: readonly GraphMode[] = ['map', 'dep'];
const REPORT_MODES: readonly ReportMode[] = [
  'timeline',
  'metrics',
  'assignees',
  'concerns',
  'coverage',
];
const ENGAGEMENT_MODES: readonly EngagementMode[] = ['agenda', 'actions', 'log', 'people'];

/** The active sub-view for a section, or null for a section with none (Spec). */
export function subOf(state: RouteState): string | null {
  switch (state.section) {
    case 'planning':
      return state.planMode;
    case 'graph':
      return state.graphMode;
    case 'reporting':
      return state.reportMode;
    case 'engagement':
      return state.engagementMode;
    default:
      return null;
  }
}

/** Canonical hash for a navigation state. */
export function hashFor(state: RouteState): string {
  const sub = subOf(state);
  return sub ? `#/${state.section}/${sub}` : `#/${state.section}`;
}

/**
 * Parse a location hash into a section + its sub-view. Returns null for an
 * unknown/empty section; an unknown sub is ignored (the section's current
 * sub-view is left untouched by the caller).
 */
export function parseHash(hash: string): RoutePatch | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const section = parts[0];
  if (!SECTIONS.includes(section as Section)) return null;
  const sub = parts[1];
  const patch: RoutePatch = { section: section as Section };
  if (section === 'planning' && PLAN_MODES.includes(sub as PlanMode)) {
    patch.planMode = sub as PlanMode;
  } else if (section === 'graph' && GRAPH_MODES.includes(sub as GraphMode)) {
    patch.graphMode = sub as GraphMode;
  } else if (section === 'reporting' && REPORT_MODES.includes(sub as ReportMode)) {
    patch.reportMode = sub as ReportMode;
  } else if (section === 'engagement' && ENGAGEMENT_MODES.includes(sub as EngagementMode)) {
    patch.engagementMode = sub as EngagementMode;
  }
  return patch;
}
