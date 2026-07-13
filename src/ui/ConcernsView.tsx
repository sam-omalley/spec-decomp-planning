/**
 * Concerns view: a monitoring board of the things a delivery lead should
 * watch — overdue work, blocked items, dependency cycles, unestimated or
 * unassigned units, thin WIP, and a projection past the target date. All
 * figures come from the pure `concerns.ts`; this is a read-only projection
 * with a jump-to-definition (`onReveal`) affordance per node-level concern.
 */

import { useProjectGraph } from '../store/appStore.ts';
import { todayIso } from '../model/graph.ts';
import { analyzeConcerns, type ConcernKind, type Severity } from '../model/concerns.ts';

const KIND_LABEL: Record<ConcernKind, string> = {
  overdue: 'Overdue',
  blocked: 'Blocked',
  cycle: 'Dependency cycle',
  unestimated: 'Unestimated',
  unassigned: 'Unassigned',
  thin_wip: 'Low WIP',
  past_target: 'Behind target',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface ConcernsViewProps {
  /** Jump to a group's definition in the plan outline. */
  onReveal?: (id: string) => void;
}

export function ConcernsView({ onReveal }: ConcernsViewProps = {}) {
  const graph = useProjectGraph();
  const concerns = analyzeConcerns(graph, todayIso());

  if (concerns.length === 0) {
    return (
      <div className="concerns-empty">
        <p className="concerns-clear">✓ No concerns</p>
        <p className="metric-hint">
          Nothing overdue, blocked, cycling, or behind target. Estimate,
          assign and start work in the Plan; concerns surface here as they
          arise.
        </p>
      </div>
    );
  }

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const c of concerns) counts[c.severity]++;

  return (
    <div className="concerns-wrap">
      <section className="concerns-summary">
        {(['high', 'medium', 'low'] as Severity[]).map((sev) => (
          <div key={sev} className={`concerns-tally concerns-tally-${sev}`}>
            <span className="concerns-tally-count">{counts[sev]}</span>
            <span className="concerns-tally-label">{SEVERITY_LABEL[sev]}</span>
          </div>
        ))}
      </section>

      <ul className="concerns-list">
        {concerns.map((c, i) => {
          const clickable = c.id !== null && onReveal;
          return (
            <li
              key={`${c.kind}:${c.id ?? 'project'}:${i}`}
              className={`concern-row concern-${c.severity}${clickable ? ' concern-row-link' : ''}`}
              onClick={clickable ? () => onReveal!(c.id!) : undefined}
              title={clickable ? `${c.title} — open in the plan outline` : undefined}
            >
              <span className={`concern-dot concern-dot-${c.severity}`} aria-hidden="true" />
              <span className="concern-kind">{KIND_LABEL[c.kind]}</span>
              <span className="concern-title">{c.title}</span>
              <span className="concern-detail">{c.detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
