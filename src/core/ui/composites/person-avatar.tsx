import {
  type AvatarSize,
  avatarInitials,
  avatarStack,
  avatarTone,
  avatarVariant,
} from "@/core/lib/avatar";
import { cn } from "@/core/lib/utils";
import { fileUrl } from "@/core/storage";

/**
 * A person's photo beside their name (v1.8 V5b-D, the approved pull-in sample): task chat, the
 * task's people, Approvals rows (a task's by whoever handed it in), People, a person's page, the
 * calendar day popup and sheet, Alerts, and since #89 (owner: "wherever a person is shown") the
 * Today Needs you and risk rows, the Tasks tab's team rows (the primary owner), New task and
 * Edit's people, and a client's Admin, each from a read the page already makes;
 * **never** inside calendar month boxes or long tables, with one exception: the laptop calendar's
 * leave bar, as "[photo] Leave" where even "Name · Leave" has no room (owner 23 Oct). Four fixed sizes (20 list rows, 28 chat
 * and Alerts, 40 People and headers, 64 a person's page and Me) and a fine ring in both themes
 * (`globals.css`). The initials on the person's own calm colour are drawn first and the photo
 * over them once it arrives, so nothing moves; lists load only the 96 px thumbnail, below the
 * fold lazily, from an immutable, privately cached URL. Decorative: the name always sits beside
 * it. A server component: no JavaScript ships for it.
 */
export type AvatarPerson = {
  /** The member's id: their colour is stable across renames and screens. */
  id: string;
  name: string;
  /** `members.avatar_file_id`, read in the same row as the name; null for initials. */
  avatarFileId: string | null;
};

export function PersonAvatar({
  person,
  size,
  eager = false,
  className,
}: {
  person: AvatarPerson;
  size: AvatarSize;
  /** Above the fold (a page header, Me): load at once rather than when scrolled to. */
  eager?: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="person-avatar"
      data-size={size}
      data-tone={avatarTone(person.id)}
      data-photo={person.avatarFileId ? "" : undefined}
      aria-hidden
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full select-none",
        className,
      )}
    >
      {avatarInitials(person.name)}
      {person.avatarFileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked route the optimiser cannot fetch
        <img
          src={fileUrl(person.avatarFileId, avatarVariant(size))}
          alt=""
          width={size}
          height={size}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          // A photo that cannot load leaves the initials showing: no broken-image mark.
          className="absolute inset-0 size-full rounded-full object-cover text-transparent"
        />
      ) : null}
    </span>
  );
}

/**
 * Several people on one thing (a task's people): up to three overlapping faces, then "+n". The
 * names are written beside it; the stack itself is decorative.
 */
export function AvatarStack({
  people,
  size = 28,
  max = 3,
  className,
}: {
  people: readonly AvatarPerson[];
  size?: AvatarSize;
  max?: number;
  className?: string;
}) {
  const { shown, more } = avatarStack(people, max);
  return (
    <span data-slot="avatar-stack" aria-hidden className={cn("inline-flex shrink-0", className)}>
      {shown.map((person) => (
        <PersonAvatar key={person.id} person={person} size={size} />
      ))}
      {more > 0 ? (
        <span
          data-slot="person-avatar"
          data-size={size}
          data-tone={4}
          data-more={more}
          className="relative inline-grid shrink-0 place-items-center rounded-full select-none"
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}
