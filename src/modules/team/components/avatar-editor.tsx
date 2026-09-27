"use client";

import { ImageUploadSheet } from "@/core/storage/components/image-upload-sheet";

import { removeOwnAvatar, setOwnAvatar } from "../actions/members";

/**
 * The member's own photo on /me (task 3.3, PRODUCT §4.16): one trigger, "Change photo", whose
 * sheet picks, previews and saves (the original is kept, a browser-made JPEG is what the app
 * shows; no SVG for photos). Its own layer, so the profile record's Save stays the screen's
 * only red action.
 */
export function AvatarEditor({ hasAvatar }: { hasAvatar: boolean }) {
  return (
    <div data-slot="avatar-editor">
      <ImageUploadSheet
        purpose="avatar"
        title="Your photo"
        triggerLabel={hasAvatar ? "Change photo" : "Add photo"}
        saveLabel="Save photo"
        removeLabel="Remove photo"
        hasCurrent={hasAvatar}
        onSave={({ fileId }) => setOwnAvatar({ fileId })}
        onRemove={() => removeOwnAvatar()}
        round
      />
    </div>
  );
}
