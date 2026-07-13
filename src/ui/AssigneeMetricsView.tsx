/**
 * Per-assignee metrics: how each team member (Resource) performs on the
 * completed plan. Figures come from the pure `assigneeMetrics.ts`:
 * estimate-vs-actual on completed stories, completed points per working day,
 * and a weekly completion histogram (points or issues). Charts are hand-rolled
 * SVG (no chart dep), matching the Metrics view.
 */

import { useState } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import { assigneeMetrics, type AssigneeMetrics } from '../model/assigneeMetrics.ts';
import { GROUP_COLORS } from './colors.ts';
import { InfoDot } from './InfoDot.tsx';

const UNASSIGNED_COLOR = '#98a2b3';

const HELP = {
  estVsActual:
    'Over each of an assignee’s completed stories (scheduling units marked done): estimate is the summed duration estimate; actual is the summed working days between each story’s actual start and finish, inclusive. Variance = actual − estimate (+ over, − under).',
  pointsPerDay:
    'Completed effort points divided by the actual working days spent on that assignee’s completed stories. Higher = more points delivered per day worked. FTE is shown for context but not divided out.',
  histogram:
    'Completed stories bucketed by the week (Monday-start) of their actual finish, stacked by assignee. Toggle between summed effort points and story count. Empty weeks between the first and last completion are kept so the cadence is visible.',
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
  const m = assigneeMetrics(graph);
  const [mode, setMode] = useState<'points' | 'issues'>('points');

  const anyCompleted = m.rows.some((r) => r.completedCount > 0);
  if (!anyCompleted) {
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

  return (
    <div className="metrics-wrap">
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
              Pts/day <InfoDot text={HELP.pointsPerDay} />
            </span>
          </div>
          {m.rows.map((r) => {
            const over = r.varianceDays > 0;
            return (
              <div key={r.id ?? '∅'} className="asg-row">
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
                        <span className="eva-num">{r.estimateDays}d</span>
                      </span>
                      <span className="eva-bar-wrap">
                        <span className="eva-tag">act</span>
                        <span
                          className={`eva-bar ${over ? 'eva-bar-over' : 'eva-bar-under'}`}
                          style={{ width: `${(r.actualDays / estActMax) * 100}%` }}
                        />
                        <span className="eva-num">{r.actualDays}d</span>
                        <span className={`asg-var${over ? ' eva-var-over' : ''}`}>
                          {r.varianceDays === 0
                            ? '±0'
                            : `${r.varianceDays > 0 ? '+' : ''}${r.varianceDays}d`}
                        </span>
                      </span>
                    </>
                  )}
                </span>
                <span className="asg-num">
                  {r.pointsPerDay === null ? '—' : r.pointsPerDay.toFixed(1)}
                </span>
              </div>
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
        <Histogram m={m} mode={mode} colors={colors} />
        <div className="asg-legend">
          {m.rows
            .filter((r) => r.completedCount > 0)
            .map((r) => (
              <span key={r.id ?? '∅'} className="asg-legend-item">
                <span className="asg-swatch" style={{ background: colors.get(r.id) }} />
                {r.name}
              </span>
            ))}
        </div>
      </section>
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
}: {
  m: AssigneeMetrics;
  mode: 'points' | 'issues';
  colors: Map<string | null, string>;
}) {
  const value = (w: { points: number; count: number }) => (mode === 'points' ? w.points : w.count);
  // Max stacked total across weeks for the y-scale.
  const max = Math.max(
    1,
    ...m.weekStarts.map((_, wi) => m.series.reduce((s, ser) => s + value(ser.weeks[wi]!), 0)),
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
            {m.series.map((ser) => {
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
