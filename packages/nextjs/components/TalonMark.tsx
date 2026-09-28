/**
 * The Talon mark: a T whose crossbar is the grip and whose stem hooks into a
 * claw, with a cyan point for the condition it waits on.
 *
 * Inline SVG rather than an <img>, so the mark takes the surrounding text
 * colour (`currentColor`) and reads correctly in both themes. The point uses
 * the accent colour. public/talon-mark.svg is the same drawing for the
 * favicon. `animated` turns on the loading motion (styles/globals.css): the
 * claw tightens and the point pulses, and both stop under reduced motion.
 */
export const TalonMark = ({ className = "h-9 w-9", animated = false }: { className?: string; animated?: boolean }) => (
  <svg viewBox="0 0 64 64" className={`${className}${animated ? " talon-animated" : ""}`} aria-hidden="true">
    <path className="talon-bar" d="M8 10 H 56 L 50 19 H 14 Z" fill="currentColor" />
    <path className="talon-claw" d="M26 19 H 40 C 42 38, 37 52, 20 60 C 29 49, 30 36, 26 19 Z" fill="currentColor" />
    <circle className="talon-point fill-accent" cx="47" cy="27" r="3.2" />
  </svg>
);
