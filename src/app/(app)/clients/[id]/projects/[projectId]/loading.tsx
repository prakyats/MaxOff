import { SERVER_PARTS } from "../../../../skeleton-parts";
import { ProjectSkeleton } from "./project-skeleton";

/** A project's page while it loads (`ProjectSkeleton`, also what a tap draws, v7.0). */
export default function Loading() {
  return <ProjectSkeleton parts={SERVER_PARTS} />;
}
