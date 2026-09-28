/**
 * The Talon mark: two claws closing around the value they guard.
 *
 * Inline SVG rather than an <img>, so the claws take the surrounding text
 * colour (`currentColor`) and read correctly in both themes. The gem uses the
 * accent colour. public/talon-mark.svg is the same drawing for the favicon.
 */
export const TalonMark = ({ className = "h-9 w-9" }: { className?: string }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <path d="M17 7 C 3 24, 5 48, 29 59 C 17 48, 13 32, 25 13 Z" fill="currentColor" />
    <path d="M47 7 C 61 24, 59 48, 35 59 C 47 48, 51 32, 39 13 Z" fill="currentColor" />
    <path d="M32 24 L 41 34 L 32 44 L 23 34 Z" className="fill-accent" />
  </svg>
);
