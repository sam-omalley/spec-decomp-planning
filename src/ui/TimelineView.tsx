/**
 * Timeline / Gantt view: bars per scheduling unit (and spanning bars for
 * their containers) on a calendar axis, with planned-start/now/target/
 * projected-finish markers and a hover crosshair. Hand-rolled SVG like
 * GraphView — no chart dep. Pure geometry comes from `timelineLayout.ts`;
 * this file only paints it.
 *
 * Zoom (mouse wheel) and pan (drag) navigate the time axis (#99): a `view`
 * window (a [start,end] sub-range of [0,1] over the model's full date
 * range) reinterprets every `frac` → pixel mapping. Row titles live outside
 * the zoomed/panned region — only the chart region (bars, gridlines,
 * markers) is clipped to the region right of the label gutter, so titles
 * never disappear or get overdrawn while navigating. Wheel/drag use native
 * listeners (via refs) rather than React's synthetic handlers so
 * `preventDefault` actually stops the container's own scroll/select. A drag
 * also scrolls `.timeline-wrap` vertically by its Y movement, so panning
 * diagonally both shifts dates and scrolls through rows in one gesture —
 * a no-op when there are too few rows for a scrollbar to exist.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useProjectGraph } from '../store/appStore.ts';
import { todayIso } from '../model/graph.ts';
import type { Baseline } from '../model/types.ts';
import { buildTimeline, dateAtFrac, groupMarkersByDate } from './timelineLayout.ts';
import type { TimelineMarker } from './timelineLayout.ts';
import { InfoDot } from './InfoDot.tsx';
import { applyScenario, type ScenarioPatch } from './scenario.ts';

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
  /** Active what-if scenario (team/speed override), or null for the real
   *  projection — see `scenario.ts`. Shared with MetricsView via App.tsx so
   *  switching Reporting sub-tabs keeps the same scenario active. */
  scenario?: ScenarioPatch | null;
  /** Selected baseline (#131) drawn as a ghost bar behind each current bar,
   *  or null/absent for none. Shared with MetricsView via App.tsx. */
  baseline?: Baseline | null;
}

const LABEL_W = 220;
const CHART_W = 760;
const ROW_H = 26;
const HEAD_H = 34;
const PAD = 12;
/** Never zoom in past a one-day-wide window. */
const MIN_VISIBLE_DAYS = 1;

interface ViewWindow {
  start: number;
  end: number;
}

const FULL_VIEW: ViewWindow = { start: 0, end: 1 };

function clampView(start: number, end: number): ViewWindow {
  const span = end - start;
  if (start < 0) return { start: 0, end: span };
  if (end > 1) return { start: 1 - span, end: 1 };
  return { start, end };
}

export function TimelineView({
  selectedId,
  onSelect,
  onReveal,
  scenario = null,
  baseline = null,
}: TimelineViewProps) {
  const graph = useProjectGraph();
  const now = todayIso();
  const effectiveGraph = useMemo(() => applyScenario(graph, scenario), [graph, scenario]);
  const model = useMemo(
    () => buildTimeline(effectiveGraph, now, baseline),
    [effectiveGraph, now, baseline],
  );
  // Hover crosshair: the fraction under the cursor, or null when the mouse
  // isn't over the chart area (outside the row-label gutter, on either side).
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  // The visible [start,end] sub-range of the full [0,1] date range.
  const [view, setView] = useState<ViewWindow>(FULL_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; view: ViewWindow; scrollTop: number } | null>(
    null,
  );

  const minSpan = Math.min(1, MIN_VISIBLE_DAYS / Math.max(1, model.rangeDays));

  // Wheel-to-zoom: attached as a native (non-passive) listener so
  // preventDefault actually suppresses the panel's own scroll — React's
  // synthetic onWheel is passive and can't stop it.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(event: WheelEvent) {
      const rect = svg!.getBoundingClientRect();
      const px = event.clientX - rect.left;
      if (px < LABEL_W) return; // over the label gutter: allow normal scroll
      event.preventDefault();
      setView((prev) => {
        const span = prev.end - prev.start;
        const cursorFrac = prev.start + ((px - LABEL_W - PAD) / CHART_W) * span;
        const factor = Math.exp(event.deltaY * 0.001);
        const newSpan = Math.min(1, Math.max(minSpan, span * factor));
        const t = (cursorFrac - prev.start) / span;
        return clampView(cursorFrac - t * newSpan, cursorFrac - t * newSpan + newSpan);
      });
    }
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [minSpan]);

  // Drag-to-pan: tracked on `window` (not the svg) so the gesture survives
  // the cursor leaving the chart area mid-drag. Horizontal movement pans the
  // time axis; vertical movement scrolls the row list — a no-op when there
  // are too few rows for `.timeline-wrap` to have a scrollbar.
  useEffect(() => {
    if (!isPanning) return;
    function onMove(event: globalThis.MouseEvent) {
      const anchor = panRef.current;
      if (!anchor) return;
      const span = anchor.view.end - anchor.view.start;
      const dFrac = (-(event.clientX - anchor.startX) / CHART_W) * span;
      setView(clampView(anchor.view.start + dFrac, anchor.view.end + dFrac));
      if (wrapRef.current) {
        wrapRef.current.scrollTop = anchor.scrollTop - (event.clientY - anchor.startY);
      }
    }
    function onUp() {
      panRef.current = null;
      setIsPanning(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  if (model.empty) {
    return (
      <div className="timeline-empty">
        <p>Nothing to schedule yet. Give delivery groups a duration estimate in the Plan.</p>
      </div>
    );
  }

  const width = LABEL_W + CHART_W + PAD * 2;
  const height = HEAD_H + model.rows.length * ROW_H + PAD * 2;
  const viewSpan = view.end - view.start;
  const x = (frac: number) => LABEL_W + PAD + ((frac - view.start) / viewSpan) * CHART_W;
  // Position of `frac` relative to the visible window, for edge-anchoring
  // text labels near the chart's left/right edge (not the full date range's).
  const relative = (frac: number) => (frac - view.start) / viewSpan;

  const hasCritical = model.rows.some((r) => r.critical);
  const hasSlack = model.rows.some((r) => r.slackEndFrac !== undefined);
  // Merge markers landing on the same date into one label — otherwise the
  // text draws on top of itself and is unreadable (#104). Lines still draw
  // one per marker (below); harmless when they coincide, since a stacked
  // vertical line isn't the readability problem the merge is fixing.
  const markerGroups = groupMarkersByDate(model.markers);

  // Attached at the svg level (not the catcher rect) so it fires whether
  // the mousedown lands on empty chart space or on top of a bar — a bar
  // keeps default pointer-events so its native title tooltip still works,
  // which means it can be the actual event target instead of the catcher.
  function handleMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (px < LABEL_W) return; // over the label gutter: let the title's onClick handle it
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      view,
      scrollTop: wrapRef.current?.scrollTop ?? 0,
    };
    setIsPanning(true);
    setHoverFrac(null);
  }

  function handleMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    if (panRef.current) return; // panning drives hoverFrac via the window listener instead
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = view.start + ((event.clientX - rect.left - LABEL_W - PAD) / CHART_W) * viewSpan;
    setHoverFrac(frac >= view.start && frac <= view.end ? frac : null);
  }

  return (
    <div className={`timeline-wrap${scenario ? ' timeline-wrap-scenario' : ''}`} ref={wrapRef}>
      <div className="tl-legend">
        How dates are calculated <InfoDot text={SCHEDULING_HELP} align="start" />
      </div>
      {hasCritical && (
        <div className="tl-legend">
          <span className="tl-legend-swatch tl-legend-critical" />
          Critical path — the dependency chain that sets the projected finish
        </div>
      )}
      {hasSlack && (
        <div className="tl-legend">
          <span className="tl-legend-swatch tl-legend-slack" />
          Slack — how far a bar could slip without delaying the project
        </div>
      )}
      {baseline && (
        <div className="tl-legend">
          <span className="tl-legend-swatch tl-legend-baseline" />
          Ghost bar — this unit's span in “{baseline.label || 'Untitled'}”
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
        ref={svgRef}
        width={width}
        height={height}
        className="timeline-svg"
        role="img"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverFrac(null)}
      >
        <defs>
          <clipPath id="tl-chart-clip">
            <rect x={LABEL_W} y={0} width={width - LABEL_W} height={height} />
          </clipPath>
          {/* Diagonal hatch for the slack (float) indicator — a texture, not
              a fill colour, so it reads without relying on colour perception. */}
          <pattern id="tl-slack-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" className="tl-slack-hatch-line" />
          </pattern>
        </defs>

        {/* row hover highlight + titles — outside the clip, never affected
            by zoom/pan, and the only clickable part of a row (#99). */}
        {model.rows.map((row, i) => {
          const y = HEAD_H + i * ROW_H;
          const selected = row.id === selectedId;
          return (
            <g key={row.id} className="tl-row">
              <rect x={0} y={y} width={width} height={ROW_H} className="tl-row-hit" />
              <rect
                x={0}
                y={y}
                width={LABEL_W}
                height={ROW_H}
                className="tl-label-hit"
                onClick={() => (onReveal ? onReveal(row.id) : onSelect(row.id))}
              />
              <text
                x={PAD + row.depth * 14}
                y={y + ROW_H / 2}
                className={`tl-label${selected ? ' tl-label-selected' : ''}`}
                dominantBaseline="middle"
              >
                {row.title.length > 26 ? `${row.title.slice(0, 25)}…` : row.title}
              </text>
            </g>
          );
        })}

        {/* chart region: bars, gridlines, markers, crosshair — clipped so
            zoom/pan can never draw over the row titles or past the svg.
            Cursor communicates the drag-to-pan affordance for the whole
            region (bars included, since they keep normal pointer events for
            their hover tooltip). */}
        <g clipPath="url(#tl-chart-clip)" style={{ cursor: isPanning ? 'grabbing' : 'grab' }}>
          {/* background catcher so mousedown/hover fire even over empty
              chart space where no other element is painted */}
          <rect x={LABEL_W} y={0} width={width - LABEL_W} height={height} className="tl-chart-catcher" />

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

          {/* bars, plus a hatched trailing extension for any slack (float) */}
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
            const hasBaseline = row.baselineStartFrac !== undefined && row.baselineEndFrac !== undefined;
            const title = (
              <title>
                {row.title}: {row.start} → {row.finish}
                {row.source === 'actual' ? ' (actual)' : ' (planned)'}
                {row.critical ? ' · on critical path' : ''}
                {row.stretchNote ? ` · ${row.stretchNote}` : ''}
                {row.slackEndFrac !== undefined
                  ? ` · could slip to ${dateAtFrac(model, row.slackEndFrac)} without delaying the project`
                  : ''}
                {hasBaseline
                  ? ` · baseline: ${dateAtFrac(model, row.baselineStartFrac!)} → ${dateAtFrac(model, row.baselineEndFrac!)}`
                  : ''}
              </title>
            );
            // Ghost bar (#131): the same unit's span in the selected baseline,
            // offset into the row's own bottom margin (never overlapping the
            // current bar) and drawn as a dashed outline rather than a fill —
            // position + stroke style carry the meaning, not colour.
            const ghostY = y + ROW_H - 6;
            const ghostH = 4;
            const gx = hasBaseline ? x(row.baselineStartFrac!) : 0;
            const gw = hasBaseline ? Math.max(3, x(row.baselineEndFrac!) - gx) : 0;
            return (
              <g key={row.id}>
                {hasBaseline && (
                  <rect x={gx} y={ghostY} width={gw} height={ghostH} rx={2} className="tl-ghost">
                    {title}
                  </rect>
                )}
                {row.slackEndFrac !== undefined && (
                  <rect
                    x={bx + bw}
                    y={barY}
                    width={Math.max(0, x(row.slackEndFrac) - (bx + bw))}
                    height={barH}
                    rx={2}
                    className="tl-slack"
                  >
                    {title}
                  </rect>
                )}
                <rect
                  x={bx}
                  y={barY}
                  width={bw}
                  height={barH}
                  rx={3}
                  className={barClass}
                  style={{ ['--bar-color' as string]: row.color }}
                >
                  {title}
                </rect>
              </g>
            );
          })}

          {/* marker lines: one per marker; coinciding lines just stack, which
              isn't the readability problem (the label below is) */}
          {model.markers.map((marker, i) => {
            const modifier = marker.kind === 'finish' ? '' : ` tl-marker-${marker.kind}`;
            return (
              <line
                key={`ml${i}`}
                x1={x(marker.frac)}
                x2={x(marker.frac)}
                y1={HEAD_H - 4}
                y2={height - PAD}
                className={`tl-marker${modifier}`}
              />
            );
          })}

          {/* marker labels: merged per date (#104) — each icon keeps its own
              kind's colour (a tspan per kind), with the shared date once at
              the end, so coinciding markers never draw overlapping text. */}
          {markerGroups.map((group, i) => {
            // A centred label at/near the chart edge spills past the visible
            // window and gets clipped — anchor to the near edge instead once
            // there isn't room either side for half the label.
            const rel = relative(group.frac);
            const anchor = rel > 0.92 ? 'end' : rel < 0.08 ? 'start' : 'middle';
            return (
              <g key={`mg${i}`}>
                <text x={x(group.frac)} y={height - 2} className="tl-marker-label" textAnchor={anchor}>
                  {group.kinds.map((kind) => (
                    <tspan
                      key={kind}
                      className={kind === 'finish' ? undefined : `tl-marker-label-${kind}`}
                    >
                      {MARKER_INFO[kind].icon}
                    </tspan>
                  ))}{' '}
                  {group.date}
                </text>
                <title>
                  {group.kinds.map((kind) => MARKER_INFO[kind].label).join(' · ')}: {group.date}
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
                textAnchor={relative(hoverFrac) > 0.92 ? 'end' : relative(hoverFrac) < 0.08 ? 'start' : 'middle'}
              >
                {dateAtFrac(model, hoverFrac)}
              </text>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
