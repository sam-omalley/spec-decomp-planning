/**
 * Timeline / Gantt view: bars per scheduling unit (and spanning bars for
 * their containers) on a calendar axis, with projected-finish and
 * target-date markers. Hand-rolled SVG like GraphView — no chart dep.
 * Pure geometry comes from `timelineLayout.ts`; this file only paints it.
 */

import { useProjectGraph } from '../store/appStore.ts';
import { todayIso } from '../model/graph.ts';
import { buildTimeline } from './timelineLayout.ts';
import { InfoDot } from './InfoDot.tsx';

const SCHEDULING_HELP =
  'Done units use their real actual dates; an in-progress unit uses its real start and projects the remainder; not-started work is fully projected and is never dated before today — so as today advances, un-started bars shift right to stay realistic.';

interface TimelineViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Jump to a bar's group definition in the plan outline. */
  onReveal?: (id: string) => void;
}

const LABEL_W = 220;
const CHART_W = 760;
const ROW_H = 26;
const HEAD_H = 34;
const PAD = 12;

export function TimelineView({ selectedId, onSelect, onReveal }: TimelineViewProps) {
  const graph = useProjectGraph();
  const model = buildTimeline(graph, todayIso());

  if (model.empty) {
    return (
      <div className="timeline-empty">
        <p>Nothing to schedule yet. Give delivery groups a duration estimate in the Plan.</p>
      </div>
    );
  }

  const width = LABEL_W + CHART_W + PAD * 2;
  const height = HEAD_H + model.rows.length * ROW_H + PAD * 2;
  const x = (frac: number) => LABEL_W + PAD + frac * CHART_W;

  const hasCritical = model.rows.some((r) => r.critical);

  return (
    <div className="timeline-wrap">
      <div className="tl-legend">
        How dates are calculated <InfoDot text={SCHEDULING_HELP} align="start" />
      </div>
      {hasCritical && (
        <div className="tl-legend">
          <span className="tl-legend-swatch tl-legend-critical" />
          Critical path — the dependency chain that sets the projected finish
        </div>
      )}
      <svg width={width} height={height} className="timeline-svg" role="img">
        {/* non-working (weekend) bands */}
        {model.weekends.map((band, i) => (
          <rect
            key={`w${i}`}
            x={x(band.startFrac)}
            y={HEAD_H}
            width={Math.max(0, x(band.endFrac) - x(band.startFrac))}
            height={height - HEAD_H - PAD}
            className="tl-weekend"
          />
        ))}

        {/* week gridlines */}
        {model.ticks.map((tick, i) => (
          <g key={`t${i}`}>
            <line
              x1={x(tick.frac)}
              x2={x(tick.frac)}
              y1={HEAD_H}
              y2={height - PAD}
              className="tl-grid"
            />
            <text x={x(tick.frac)} y={HEAD_H - 8} className="tl-tick-label" textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {/* rows */}
        {model.rows.map((row, i) => {
          const y = HEAD_H + i * ROW_H;
          const barY = y + 5;
          const barH = ROW_H - 12;
          const bx = x(row.startFrac);
          const bw = Math.max(3, x(row.endFrac) - bx);
          const selected = row.id === selectedId;
          const barClass =
            (row.isUnit ? 'tl-bar' : 'tl-bar tl-bar-container') +
            (row.source === 'actual' ? ' tl-bar-actual' : '') +
            (row.critical ? ' tl-bar-critical' : '') +
            (selected ? ' tl-bar-selected' : '');
          return (
            <g
              key={row.id}
              className="tl-row"
              onClick={() => (onReveal ? onReveal(row.id) : onSelect(row.id))}
            >
              <rect x={0} y={y} width={width} height={ROW_H} className="tl-row-hit" />
              <text
                x={PAD + row.depth * 14}
                y={y + ROW_H / 2}
                className={`tl-label${selected ? ' tl-label-selected' : ''}`}
                dominantBaseline="middle"
              >
                {row.title.length > 26 ? `${row.title.slice(0, 25)}…` : row.title}
              </text>
              <rect
                x={bx}
                y={barY}
                width={bw}
                height={barH}
                rx={3}
                className={barClass}
                style={{ ['--bar-color' as string]: row.color }}
              >
                <title>
                  {row.title}: {row.start} → {row.finish}
                  {row.source === 'actual' ? ' (actual)' : ' (planned)'}
                  {row.critical ? ' · on critical path' : ''}
                </title>
              </rect>
            </g>
          );
        })}

        {/* markers */}
        {model.markers.map((marker, i) => (
          <g key={`m${i}`}>
            <line
              x1={x(marker.frac)}
              x2={x(marker.frac)}
              y1={HEAD_H - 4}
              y2={height - PAD}
              className={marker.kind === 'target' ? 'tl-marker tl-marker-target' : 'tl-marker'}
            />
            <text
              x={x(marker.frac)}
              y={height - 2}
              className={`tl-marker-label${
                marker.kind === 'target' ? ' tl-marker-label-target' : ''
              }`}
              textAnchor="middle"
            >
              {marker.kind === 'target' ? '🎯 ' : '▸ '}
              {marker.date}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
