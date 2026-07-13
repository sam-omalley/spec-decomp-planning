/**
 * Metrics view: projection summary cards, a burn-up chart, and an
 * estimate-vs-actual breakdown. All figures come from the pure
 * `metrics.ts`; charts are hand-rolled SVG (no chart dep).
 */

import { useProjectGraph } from '../store/appStore.ts';
import { todayIso } from '../model/graph.ts';
import {
  burnUp,
  calendarDaysBetween,
  estimateVsActual,
  projectionSummary,
} from '../model/metrics.ts';

const CHART_W = 620;
const CHART_H = 200;
const PAD = 28;

/**
 * How each metric is calculated, in one place so the hover copy can't
 * drift from the pure `metrics.ts`/`schedule.ts` logic it describes.
 */
const HELP = {
  projectFinish:
    'The latest finish across all scheduling units, from the forward scheduler: each unit is placed on the earliest-free of the resource/track capacity, its duration is the estimate ÷ speed on a weekdays-only calendar. Actuals (done / in-progress units) override the projection.',
  target:
    'The target date you set in ⚙ Settings — a reference line only. It never changes the projection; it just gives the variance something to measure against.',
  variance:
    'Calendar days between the target date and the projected finish. Positive = late (finish lands after the target), negative = early. “On track” means ≤ 0.',
  progress:
    'Summed unit duration estimates in working days: done units vs the whole plan. Remaining = total − done. Points are the summed effort of the not-done units.',
  criticalPath:
    'The chain that sets the finish: starting from the last-finishing unit, walk back through each binding prerequisite (the one whose finish set the next unit’s start), stopping at a real start or a capacity/“today” limit. Independent work off this chain doesn’t move the date.',
  burnUp:
    'Cumulative completed scope (working days) stepping up at each unit’s actual finish, against the constant total scope. The ideal line runs from the start to the projected finish; 🎯 marks the target date.',
  estimateVsActual:
    'For each completed unit: estimate is its duration estimate; actual is the working days between its actual start and finish, inclusive of both. Variance = actual − estimate (+ over, − under).',
} as const;

/**
 * A small ⓘ glyph that reveals an explanation of a metric on hover/focus.
 * `down` opens the tip below the glyph instead of above — used near the top
 * of the view (the summary cards) so the tip never clips off the viewport.
 */
function InfoDot({ text, down }: { text: string; down?: boolean }) {
  return (
    <span className="info-dot" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">ⓘ</span>
      <span className={`info-tip${down ? ' info-tip-down' : ''}`} role="tooltip">
        {text}
      </span>
    </span>
  );
}

interface MetricsViewProps {
  /** Jump to a unit's group definition in the plan outline. */
  onReveal?: (id: string) => void;
}

export function MetricsView({ onReveal }: MetricsViewProps = {}) {
  const graph = useProjectGraph();
  const now = todayIso();
  const summary = projectionSummary(graph, now);
  const variance = estimateVsActual(graph);
  const burn = burnUp(graph, now);

  if (summary.totalDays === 0 && summary.totalPoints === 0) {
    return (
      <div className="metrics-empty">
        <p>No estimates yet. Give delivery groups a duration in the Plan to see projections.</p>
      </div>
    );
  }

  const varianceText =
    summary.varianceDays === null
      ? '—'
      : summary.varianceDays === 0
        ? 'on target'
        : `${Math.abs(summary.varianceDays)}d ${summary.varianceDays > 0 ? 'late' : 'early'}`;

  return (
    <div className="metrics-wrap">
      <section className="metric-cards">
        <Card label="Projected finish" value={summary.projectFinish ?? '—'} help={HELP.projectFinish} />
        <Card label="Target" value={summary.targetDate ?? 'none set'} help={HELP.target} />
        <Card
          label="Variance"
          value={varianceText}
          tone={summary.onTrack === null ? undefined : summary.onTrack ? 'good' : 'bad'}
          help={HELP.variance}
        />
        <Card
          label="Progress"
          value={`${summary.doneDays} / ${summary.totalDays}d`}
          sub={`${summary.remainingDays}d remaining${
            summary.remainingPoints > 0 ? ` · ${summary.remainingPoints}pt` : ''
          }`}
          help={HELP.progress}
        />
      </section>

      {summary.criticalPath.length > 0 && (
        <section className="metric-panel">
          <h3>
            Critical path — what sets the projected finish <InfoDot text={HELP.criticalPath} />
          </h3>
          <div className="crit-path">
            {summary.criticalPath.map((u, i) => (
              <span key={u.id} className="crit-step">
                {i > 0 && <span className="crit-arrow">→</span>}
                <button
                  type="button"
                  className={`crit-node${onReveal ? ' crit-node-link' : ''}`}
                  onClick={onReveal ? () => onReveal(u.id) : undefined}
                  title={onReveal ? `${u.title} — open in the plan outline` : u.title}
                >
                  {u.title}
                </button>
              </span>
            ))}
          </div>
          <p className="metric-hint">
            {summary.criticalPath.length > 1
              ? 'These units run back-to-back by dependency; shortening or resequencing this chain moves the finish date. Independent work off this path does not.'
              : 'The finish is set by this single unit (capacity- or start-bound), not a dependency chain.'}
          </p>
        </section>
      )}

      <section className="metric-panel">
        <h3>
          Burn-up — completed vs total scope (days) <InfoDot text={HELP.burnUp} />
        </h3>
        <BurnUpChart graph={graph} summary={summary} burn={burn} />
      </section>

      <section className="metric-panel">
        <h3>
          Estimate vs actual (completed units) <InfoDot text={HELP.estimateVsActual} />
        </h3>
        {variance.rows.length === 0 ? (
          <p className="metric-hint">No completed units yet — finish some to compare.</p>
        ) : (
          <EstimateVsActual variance={variance} onReveal={onReveal} />
        )}
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
  help,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad';
  help?: string;
}) {
  return (
    <div className={`metric-card${tone ? ` metric-card-${tone}` : ''}`}>
      <div className="metric-card-label">
        {label}
        {help && <InfoDot text={help} down />}
      </div>
      <div className="metric-card-value">{value}</div>
      {sub && <div className="metric-card-sub">{sub}</div>}
    </div>
  );
}

function BurnUpChart({
  graph,
  summary,
  burn,
}: {
  graph: ReturnType<typeof useProjectGraph>;
  summary: ReturnType<typeof projectionSummary>;
  burn: ReturnType<typeof burnUp>;
}) {
  const total = burn[0]?.total ?? summary.totalDays;
  const start = burn[0]?.date ?? summary.projectStart ?? graph.settings.startDate;
  const candidates = [
    burn[burn.length - 1]?.date,
    summary.projectFinish,
    summary.targetDate,
  ].filter((d): d is string => !!d);
  let end = start;
  for (const d of candidates) if (d > end) end = d;
  const span = Math.max(1, calendarDaysBetween(start, end));

  const x = (date: string) => PAD + (calendarDaysBetween(start, date) / span) * (CHART_W - PAD * 2);
  const y = (value: number) => CHART_H - PAD - (total === 0 ? 0 : value / total) * (CHART_H - PAD * 2);

  const donePath = burn
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.date).toFixed(1)} ${y(p.done).toFixed(1)}`)
    .join(' ');
  const idealTo = summary.projectFinish ?? end;

  return (
    <svg width={CHART_W} height={CHART_H} className="burn-svg" role="img">
      {/* axes */}
      <line x1={PAD} y1={CHART_H - PAD} x2={CHART_W - PAD} y2={CHART_H - PAD} className="axis" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={CHART_H - PAD} className="axis" />
      {/* total scope line */}
      <line x1={PAD} y1={y(total)} x2={CHART_W - PAD} y2={y(total)} className="burn-total" />
      <text x={CHART_W - PAD} y={y(total) - 4} textAnchor="end" className="burn-axis-label">
        total {total}d
      </text>
      {/* ideal burn-up start → projected finish */}
      <line x1={x(start)} y1={y(0)} x2={x(idealTo)} y2={y(total)} className="burn-ideal" />
      {/* target marker */}
      {summary.targetDate && (
        <line
          x1={x(summary.targetDate)}
          y1={PAD}
          x2={x(summary.targetDate)}
          y2={CHART_H - PAD}
          className="burn-target"
        />
      )}
      {/* actual done */}
      <path d={donePath} className="burn-done" fill="none" />
      {burn.map((p, i) => (
        <circle key={i} cx={x(p.date)} cy={y(p.done)} r={3} className="burn-dot" />
      ))}
      <text x={PAD} y={CHART_H - 8} className="burn-axis-label">
        {start}
      </text>
      <text x={CHART_W - PAD} y={CHART_H - 8} textAnchor="end" className="burn-axis-label">
        {end}
      </text>
    </svg>
  );
}

function EstimateVsActual({
  variance,
  onReveal,
}: {
  variance: ReturnType<typeof estimateVsActual>;
  onReveal?: (id: string) => void;
}) {
  const max = Math.max(
    1,
    ...variance.rows.flatMap((r) => [r.estimateDays ?? 0, r.actualDays ?? 0]),
  );
  return (
    <div className="eva">
      {variance.rows.map((row) => {
        const over = (row.varianceDays ?? 0) > 0;
        return (
          <div
            key={row.id}
            className={`eva-row${onReveal ? ' eva-row-link' : ''}`}
            onClick={onReveal ? () => onReveal(row.id) : undefined}
            title={onReveal ? `${row.title} — open in the plan outline` : row.title}
          >
            <div className="eva-title">{row.title}</div>
            <div className="eva-bars">
              <div className="eva-bar-wrap">
                <span className="eva-tag">est</span>
                <div
                  className="eva-bar eva-bar-est"
                  style={{ width: `${((row.estimateDays ?? 0) / max) * 100}%` }}
                />
                <span className="eva-num">{row.estimateDays ?? '—'}d</span>
              </div>
              <div className="eva-bar-wrap">
                <span className="eva-tag">act</span>
                <div
                  className={`eva-bar ${over ? 'eva-bar-over' : 'eva-bar-under'}`}
                  style={{ width: `${((row.actualDays ?? 0) / max) * 100}%` }}
                />
                <span className="eva-num">{row.actualDays ?? '—'}d</span>
              </div>
            </div>
            <div className={`eva-var${over ? ' eva-var-over' : ''}`}>
              {row.varianceDays === null
                ? ''
                : row.varianceDays === 0
                  ? '±0'
                  : `${row.varianceDays > 0 ? '+' : ''}${row.varianceDays}d`}
            </div>
          </div>
        );
      })}
      <div className="eva-total">
        Rolled: est {variance.totalEstimate}d · actual {variance.totalActual}d ·{' '}
        {variance.totalActual - variance.totalEstimate >= 0 ? '+' : ''}
        {variance.totalActual - variance.totalEstimate}d
      </div>
    </div>
  );
}
