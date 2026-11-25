import { SERVER_PARTS } from "../../skeleton-parts";
import { LeaveRequestsSkeleton } from "./leave-requests-skeleton";

/** The requests view while it loads (`LeaveRequestsSkeleton`, also in the tap drawing, v7.0). */
export default function Loading() {
  return <LeaveRequestsSkeleton parts={SERVER_PARTS} />;
}
