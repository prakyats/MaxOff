import { cn } from "@/core/lib/utils";

import { fileUrl } from "../index";

/**
 * An image served by `/api/files/<id>` (kickoff 3 decision 12): the same-origin route checks the
 * record's permission and answers with `Cache-Control: private`, so a list of forty logos is
 * forty cacheable requests. A plain `<img>` on purpose: Next's image optimiser fetches URLs
 * itself, without the viewer's session, so it can never read a private file.
 */
export function FileImage({
  fileId,
  alt,
  variant = "preview",
  className,
  ...rest
}: {
  fileId: string;
  alt: string;
  variant?: "preview" | "original";
  className?: string;
} & Pick<React.ImgHTMLAttributes<HTMLImageElement>, "width" | "height" | "loading" | "decoding">) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked route the optimiser cannot fetch
    <img
      src={fileUrl(fileId, variant)}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-slot="file-image"
      data-file-id={fileId}
      className={cn("object-contain", className)}
      {...rest}
    />
  );
}
