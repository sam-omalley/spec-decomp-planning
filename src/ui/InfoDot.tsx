/**
 * A small ⓘ glyph that reveals an explanation on hover/focus (pure CSS
 * tooltip; see `.info-dot` / `.info-tip` in styles.css). Shared by the
 * reporting views so a metric can document how it is calculated.
 *
 * The tip opens *below* the glyph: the dots sit on card labels / panel
 * headings with content beneath, so downward never clips, whereas an upward
 * tip clips off the top when its row scrolls near the viewport top.
 *
 * `align` sets the horizontal open direction for dots near a container edge,
 * where a centred tip would overflow and force a horizontal scrollbar:
 * `start` opens rightward (for left-edge dots), `end` opens leftward (for
 * right-edge dots). Default is centred.
 */
export function InfoDot({ text, align }: { text: string; align?: 'start' | 'end' }) {
  return (
    <span className="info-dot" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">ⓘ</span>
      <span className={`info-tip${align ? ` info-tip-${align}` : ''}`} role="tooltip">
        {text}
      </span>
    </span>
  );
}
