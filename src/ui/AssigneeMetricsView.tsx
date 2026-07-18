/**
 * Per-assignee metrics: how each team member (Resource) performs on the
 * completed plan. Figures come from the pure `assigneeMetrics.ts`:
 * estimate-vs-actual on completed stories, completed points per working day,
 * and a weekly completion histogram (points or issues). Charts are hand-rolled
 * SVG (no chart dep), matching the Metrics view.
 */

import { useMemo, useState } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import { assigneeMetrics, type AssigneeMetrics } from '../model/assigneeMetrics.ts';
import { forwardLoad, type ForwardLoadModel } from '../model/forwardLoad.ts';
import { todayIso } from '../model/graph.ts';
import { GROUP_COLORS } from './colors.ts';
import { InfoDot } from './InfoDot.tsx';
import { formatDays } from './format.ts';

const UNASSIGNED_COLOR = '#98a2b3';

const HELP = {
  estVsActual:
    'Over each of an assignee’s completed stories (scheduling units marked done): estimate is the summed duration estimate; actual is the summed working days between each story’s actual start and finish, inclusive. Variance = actual − estimate (+ over, − under).',
  pointsPerDay:
    'Completed effort points divided by the actual working days spent on that assignee’s completed stories. Higher = more points delivered per day worked. FTE is shown for context but not divided out.',
  histogram:
    'Completed stories bucketed by the week (Monday-start) of their actual finish, stacked by assignee. Toggle between summed effort points and story count. Empty weeks between the first and last completion are kept so the cadence is visible.',
  forward:
    'Working days per week (weekends, holidays, and that resource’s own leave already excluded) that the projected schedule has committed on each resource’s track, vs. how many are available — from scheduleProject, the same projection Timeline/Metrics use. Never over 100%: the scheduler places one thing at a time per resource, so this shows how close to full someone is, not double-booking.',
} as const;

/** Stable per-assignee colour: resources cycle the shared palette by their
 *  row position; the Unassigned bucket is neutral grey. */
function colorMap(m: AssigneeMetrics): Map<string | null, string> {
  const map = new Map<string | null, string>();
  let i = 0;
  for (const r of m.rows) {
    map.set(r.id, r.id === null ? UNASSIGNED_COLOR : GROUP_COLORS[i++ % GROUP_COLORS.length]!);
  }
  return map;
}

export function AssigneeMetricsView() {
  const graph = useProjectGraph();
  const m = useMemo(() => assigneeMetrics(graph), [graph]);
  const forward = useMemo(() => forwardLoad(graph, todayIso()), [graph]);
  const [mode, setMode] = useState<'points' | 'issues'>('points');
  // Which assignee the histogram is filtered to (#49); null = all. The id may
  // itself be null (the Unassigned bucket), so the "all" state is the outer
  // null, and a selection is a wrapper object.
  const [selected, setSelected] = useState<{ id: string | null } | null>(null);
  const toggle = (id: string | null) =>
    setSelected((cur) => (cur && cur.id === id ? null : { id }));

  const anyCompleted = m.rows.some((r) => r.completedCount > 0);
  const hasForward = forward.resources.length > 0;
  if (!anyCompleted && !hasForward) {
    const noTeam = graph.settings.resources.length === 0;
    return (
      <div className="metrics-empty">
        <p>
          {noTeam
            ? 'No per-assignee data yet. Add a team in ⚙ Settings and assign delivery groups, then complete some to compare.'
            : 'No completed stories yet. Finish some assigned delivery groups to see estimate-vs-actual and throughput per assignee.'}
        </p>
      </div>
    );
  }

  const colors = colorMap(m);
  const estActMax = Math.max(1, ...m.rows.flatMap((r) => [r.estimateDays, r.actualDays]));

  // Only assignees with completed work can be filtered on; guard against a
  // selection going stale if the underlying data changes.
  const filterable = new Set(m.rows.filter((r) => r.completedCount > 0).map((r) => r.id));
  const active = selected && filterable.has(selected.id) ? selected : null;
  const isSelected = (id: string | null) => active !== null && active.id === id;
  const filtering = active !== null;

  return (
    <div className="metrics-wrap">
      {anyCompleted && (
      <>
      <section className="metric-panel">
        <h3>
          Estimate vs actual &amp; throughput <InfoDot text={HELP.estVsActual} />
        </h3>
        <div className="asg-table">
          <div className="asg-head">
            <span>Assignee</span>
            <span className="asg-num">Done</span>
            <span>Estimate vs actual (days)</span>
            <span className="asg-num">
              Pts/day <InfoDot text={HELP.pointsPerDay} align="end" />
            </span>
          </div>
          {m.rows.map((r) => {
            const over = r.varianceDays > 0;
            const canFilter = r.completedCount > 0;
            const cls = isSelected(r.id)
              ? ' asg-row-active'
              : filtering
                ? ' asg-row-dim'
                : '';
            return (
              <button
                type="button"
                key={r.id ?? '∅'}
                className={`asg-row${cls}`}
                disabled={!canFilter}
                aria-pressed={isSelected(r.id)}
                title={canFilter ? `Filter the histogram to ${r.name}` : undefined}
                onClick={() => canFilter && toggle(r.id)}
              >
                <span className="asg-name">
                  <span className="asg-swatch" style={{ background: colors.get(r.id) }} />
                  {r.name}
                  {r.fte !== null && r.fte !== 1 && (
                    <span className="asg-fte">{r.fte} FTE</span>
                  )}
                </span>
                <span className="asg-num">{r.completedCount}</span>
                <span className="asg-bars">
                  {r.completedCount === 0 ? (
                    <span className="asg-empty">—</span>
                  ) : (
                    <>
                      <span className="eva-bar-wrap">
                        <span className="eva-tag">est</span>
                        <span
                          className="eva-bar eva-bar-est"
                          style={{ width: `${(r.estimateDays / estActMax) * 100}%` }}
                        />
                        <span className="eva-num">{formatDays(r.estimateDays)}d</span>
                      </span>
                      <span className="eva-bar-wrap">
                        <span className="eva-tag">act</span>
                        <span
                          className={`eva-bar ${over ? 'eva-bar-over' : 'eva-bar-under'}`}
                          style={{ width: `${(r.actualDays / estActMax) * 100}%` }}
                        />
                        <span className="eva-num">{formatDays(r.actualDays)}d</span>
                        <span className={`asg-var${over ? ' eva-var-over' : ''}`}>
                          {r.varianceDays === 0
                            ? '±0'
                            : `${r.varianceDays > 0 ? '+' : ''}${formatDays(r.varianceDays)}d`}
                        </span>
                      </span>
                    </>
                  )}
                </span>
                <span className="asg-num">
                  {r.pointsPerDay === null ? '—' : r.pointsPerDay.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="metric-panel">
        <div className="asg-panel-head">
          <h3>
            Completed per week <InfoDot text={HELP.histogram} />
          </h3>
          <div className="view-tabs asg-toggle" role="group" aria-label="Histogram measure">
            <button
              className={mode === 'points' ? 'view-tab view-tab-active' : 'view-tab'}
              onClick={() => setMode('points')}
            >
              Points
            </button>
            <button
              className={mode === 'issues' ? 'view-tab view-tab-active' : 'view-tab'}
              onClick={() => setMode('issues')}
            >
              Issues
            </button>
          </div>
        </div>
        <Histogram m={m} mode={mode} colors={colors} selectedId={active?.id} />
        <div className="asg-legend">
          {m.rows
            .filter((r) => r.completedCount > 0)
            .map((r) => (
              <button
                type="button"
                key={r.id ?? '∅'}
                className={`asg-legend-item${
                  isSelected(r.id)
                    ? ' asg-legend-item-active'
                    : filtering
                      ? ' asg-legend-item-dim'
                      : ''
                }`}
                aria-pressed={isSelected(r.id)}
                title={`Filter the histogram to ${r.name}`}
                onClick={() => toggle(r.id)}
              >
                <span className="asg-swatch" style={{ background: colors.get(r.id) }} />
                {r.name}
              </button>
            ))}
          {filtering && (
            <button type="button" className="asg-legend-clear" onClick={() => setSelected(null)}>
              Show all
            </button>
          )}
        </div>
      </section>
      </>
      )}

      {hasForward && (
        <section className="metric-panel">
          <h3>
            Forward capacity <InfoDot text={HELP.forward} align="start" />
          </h3>
          <ForwardCapacity model={forward} />
        </section>
      )}
    </div>
  );
}

function ForwardCapacity({ model }: { model: ForwardLoadModel }) {
  return (
    <div className="fwd-table">
      <div className="fwd-row fwd-head">
        <span className="fwd-name">Resource</span>
        {model.weekStarts.map((w) => (
          <span key={w} className="fwd-cell fwd-week-label">
            {w.slice(5)}
          </span>
        ))}
      </div>
      {model.resources.map((r) => (
        <div className="fwd-row" key={r.id}>
          <span className="fwd-name">
            {r.name}
            {r.fte !== 1 && <span className="asg-fte">{r.fte} FTE</span>}
          </span>
          {r.weeks.map((w) => {
            const pct = Math.round(w.utilization * 100);
            const state =
              w.capacityDays === 0 ? 'off' : pct === 0 ? 'idle' : pct >= 100 ? 'full' : 'mid';
            return (
              <span
                key={w.weekStart}
                className={`fwd-cell fwd-cell-${state}`}
                title={`Week of ${w.weekStart}: ${w.committedDays} of ${w.capacityDays} working days committed`}
              >
                <span
                  className="fwd-cell-fill"
                  style={{ width: `${Math.min(100, pct)}%` }}
                  aria-hidden="true"
                />
                <span className="fwd-cell-label">
                  {state === 'off' ? '—' : state === 'idle' ? 'Idle' : `${pct}%`}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const CHART_W = 620;
const CHART_H = 200;
const PAD = 28;

function Histogram({
  m,
  mode,
  colors,
  selectedId,
}: {
  m: AssigneeMetrics;
  mode: 'points' | 'issues';
  colors: Map<string | null, string>;
  /** When set (including null = Unassigned), show only that assignee's series.
   *  `undefined` = all assignees. */
  selectedId?: string | null;
}) {
  const value = (w: { points: number; count: number }) => (mode === 'points' ? w.points : w.count);
  // Show one assignee's series when filtered, else all (#49).
  const series =
    selectedId === undefined ? m.series : m.series.filter((ser) => ser.id === selectedId);
  // Max stacked total across weeks for the y-scale — recomputed over the shown
  // series so a single filtered assignee fills the chart.
  const max = Math.max(
    1,
    ...m.weekStarts.map((_, wi) => series.reduce((s, ser) => s + value(ser.weeks[wi]!), 0)),
  );

  const plotW = CHART_W - PAD * 2;
  const plotH = CHART_H - PAD * 2;
  const n = m.weekStarts.length;
  const slot = plotW / n;
  const barW = Math.min(38, slot * 0.7);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="hist-svg" role="img" preserveAspectRatio="xMidYMid meet">
      {/* baseline */}
      <line x1={PAD} y1={CHART_H - PAD} x2={CHART_W - PAD} y2={CHART_H - PAD} className="axis" />
      <text x={PAD} y={PAD - 10} className="burn-axis-label">
        max {max}
        {mode === 'points' ? 'pt' : ''}
      </text>
      {m.weekStarts.map((week, wi) => {
        const cx = PAD + slot * wi + slot / 2;
        let yTop = CHART_H - PAD;
        return (
          <g key={week}>
            {series.map((ser) => {
              const v = value(ser.weeks[wi]!);
              if (v === 0) return null;
              const h = (v / max) * plotH;
              yTop -= h;
              return (
                <rect
                  key={ser.id ?? '∅'}
                  x={cx - barW / 2}
                  y={yTop}
                  width={barW}
                  height={h}
                  fill={colors.get(ser.id)}
                  className="hist-bar"
                >
                  <title>
                    {ser.name} · week of {week}: {v}
                    {mode === 'points' ? 'pt' : v === 1 ? ' story' : ' stories'}
                  </title>
                </rect>
              );
            })}
            <text x={cx} y={CHART_H - PAD + 14} textAnchor="middle" className="burn-axis-label">
              {week.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
