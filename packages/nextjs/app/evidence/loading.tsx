import { PageLoading } from "~~/components/PageLoading";

export default function Loading() {
  return (
    <PageLoading title="Reading the public record" description="Fetching evidence from Hedera's consensus service." />
  );
}
