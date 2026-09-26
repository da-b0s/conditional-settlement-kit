import { PageLoading } from "~~/components/PageLoading";

export default function Loading() {
  return (
    <PageLoading title="Fetching evidence" description="Reading the public settlement trail from Hedera testnet." />
  );
}
