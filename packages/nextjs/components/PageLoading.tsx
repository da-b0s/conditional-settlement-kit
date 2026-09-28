import { TalonMark } from "~~/components/TalonMark";

/**
 * The Talon loading screen: the claw tightens, the point pulses, a slim bar
 * runs underneath. Server-renderable, CSS-only motion (styles/globals.css),
 * and still under prefers-reduced-motion.
 */
export function PageLoading({
  title = "Getting a grip",
  description = "Loading the page.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-24 text-center"
      role="status"
      aria-live="polite"
    >
      <TalonMark animated className="h-16 w-16 text-base-content" />
      <p className="mt-6 text-lg font-semibold">{title}</p>
      <p className="mt-1.5 text-sm text-base-content/65">{description}</p>
      <div className="talon-progress mt-6" aria-hidden="true" />
    </div>
  );
}
