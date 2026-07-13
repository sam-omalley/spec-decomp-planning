/**
 * A small ⓘ glyph that reveals an explanation on hover/focus (pure CSS
 * tooltip; see `.info-dot` / `.info-tip` in styles.css). Shared by the
 * reporting views so a metric can document how it is calculated.
 *
 * The tip opens *below* the glyph: the dots sit on card labels / panel
 * headings with content beneath, so downward never clips, whereas an upward
 * tip clips off the top when its row scrolls near the viewport top.
 */
export function InfoDot({ text }: { text: string }) {
  return (
    <span className="info-dot" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">ⓘ</span>
      <span className="info-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}
