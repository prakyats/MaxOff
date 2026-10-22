import { fileUrl } from "@/core/storage";

/**
 * A writer's photo in Chat (v1.8 V5b E): a 28px round slot with their initials (the look of the
 * avatar primitive's fallback, `core/ui/primitives/avatar`) and, when they have one, the photo's
 * preview over it. Plain markup, no script: the primitive's Radix root would add its code to the
 * task page's first load. The slot is fixed, so a shared people avatar can take its place without
 * moving the feed.
 */
export function ChatAvatar({ photo, initials }: { photo: string | null; initials: string }) {
  return (
    <span
      aria-hidden
      data-slot="chat-avatar"
      className="bg-muted text-muted-foreground ring-border relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-medium ring-1"
    >
      {initials}
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin preview, sized by CSS
        <img
          src={fileUrl(photo)}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      ) : null}
    </span>
  );
}
