"use client";

import { useFormStatus } from "react-dom";

export function ReadEvidenceButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending} aria-live="polite">
      {pending ? "Fetching evidence…" : "Read the trail"}
    </button>
  );
}
