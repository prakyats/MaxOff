"use client";

import type { ReactNode } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { UploadsCardProps } from "./uploads-card";

const loadCard = () => import("./uploads-card").then((module) => module.UploadsCard);

/**
 * The Uploads card **loaded after the page** (ARCHITECTURE §19, the first-load diet): the task
 * page's first load keeps its budget, and the card's first paint is `children`, the same markup
 * drawn on the server (`UploadsCardBody`), so nothing moves when the live card takes over.
 */
export function UploadsCardLazy({
  children,
  ...props
}: UploadsCardProps & { children: ReactNode }) {
  return (
    <AfterPage load={loadCard} props={props} fallback={<div className="min-w-0">{children}</div>} />
  );
}
