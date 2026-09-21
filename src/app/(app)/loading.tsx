import { PageLoading } from "@/core/ui/composites/loading-state";

/** Streaming fallback for every page in the shell while its server data loads. */
export default function AppLoading() {
  return <PageLoading />;
}
