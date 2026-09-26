"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RetryRead() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm mt-3"
      disabled={pending}
      aria-live="polite"
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Trying again…" : "Try again"}
    </button>
  );
}
