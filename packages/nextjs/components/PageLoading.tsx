export function PageLoading({
  title = "Loading page",
  description = "Please wait while this page is prepared.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="loading loading-spinner loading-md text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      <p className="mt-3 text-base-content/80">{description}</p>
    </div>
  );
}
