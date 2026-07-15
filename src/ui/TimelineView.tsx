/**
 * Timeline / Gantt view: bars per scheduling unit (and spanning bars for
 * their containers) on a calendar axis, with planned-start/now/target/
 * projected-finish markers and a hover crosshair. Hand-rolled SVG like
 * GraphView — no chart dep. Pure geometry comes from `timelineLayout.ts`;
 * this file only paints it.
 */

import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import { todayIso } from '../model/graph.ts';
import { buildTimeline, dateAtFrac } from './timelineLayout.ts';
import type { TimelineMarker } from './timelineLayout.ts';
import { InfoDot } from './InfoDot.tsx';

/** Icon + short label per marker kind — colorblind-safe (never color-only),
 *  matching the convention used for concern severities/dependency edges
 *  elsewhere in the app. */
const MARKER_INFO: Record<TimelineMarker['kind'], { icon: string; label: string }> = {
  start: { icon: '🚩', label: 'Planned start' },
  now: { icon: '⏱', label: 'Now' },
  target: { icon: '🎯', label: 'Planned end' },
  finish: { icon: '▸', label: 'Projected finish' },
};

const SCHEDULING_HELP =
  'Done units use their real actual dates; an in-progress unit uses its real start and projects the remainder; not-started work is fully projected and is never dated before today — so as today advances, un-started bars shift right to stay realistic. A projected span can run longer than the raw estimate when the speed multiplier or an assigned resource’s FTE is below 1× (Settings tab) — hover a bar for the breakdown when that applies.';

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
  const now = todayIso();
  const model = useMemo(() => buildTimeline(graph, now), [graph, now]);
  // Hover crosshair: the fraction under the cursor, or null when the mouse
  // isn't over the chart area (outside the row-label gutter, on either side).
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);

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

  function handleMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left - LABEL_W - PAD) / CHART_W;
    setHoverFrac(frac >= 0 && frac <= 1 ? frac : null);
  }

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
      <div className="tl-legend tl-legend-markers">
        {(Object.keys(MARKER_INFO) as TimelineMarker['kind'][]).map((kind) => (
          <span key={kind}>
            {MARKER_INFO[kind].icon} {MARKER_INFO[kind].label}
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={height}
        className="timeline-svg"
        role="img"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverFrac(null)}
      >
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
                  {row.stretchNote ? ` · ${row.stretchNote}` : ''}
                </title>
              </rect>
            </g>
          );
        })}

        {/* markers */}
        {model.markers.map((marker, i) => {
          // A centred label at/near the chart edge spills past the SVG
          // boundary and gets clipped — anchor to the near edge instead once
          // there isn't room either side for half the label.
          const anchor = marker.frac > 0.92 ? 'end' : marker.frac < 0.08 ? 'start' : 'middle';
          const info = MARKER_INFO[marker.kind];
          const modifier = marker.kind === 'finish' ? '' : ` tl-marker-${marker.kind}`;
          return (
            <g key={`m${i}`}>
              <line
                x1={x(marker.frac)}
                x2={x(marker.frac)}
                y1={HEAD_H - 4}
                y2={height - PAD}
                className={`tl-marker${modifier}`}
              />
              <text
                x={x(marker.frac)}
                y={height - 2}
                className={`tl-marker-label${modifier ? ` tl-marker-label-${marker.kind}` : ''}`}
                textAnchor={anchor}
              >
                {info.icon} {marker.date}
              </text>
              <title>
                {info.label}: {marker.date}
              </title>
            </g>
          );
        })}

        {/* hover crosshair: the date under the cursor */}
        {hoverFrac !== null && (
          <g className="tl-crosshair" pointerEvents="none">
            <line x1={x(hoverFrac)} x2={x(hoverFrac)} y1={HEAD_H} y2={height - PAD} />
            <text
              x={x(hoverFrac)}
              y={16}
              textAnchor={hoverFrac > 0.92 ? 'end' : hoverFrac < 0.08 ? 'start' : 'middle'}
            >
              {dateAtFrac(model, hoverFrac)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
