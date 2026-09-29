import { describe, expect, it } from "vitest";

import { resolveAppOrigin } from "@/core/lib/app-url";

import { inviteEmail, inviteLinkFor } from "../domain/invite";
import {
  coordinatorOptions,
  freelancerLine,
  hasAttendance,
  memberActions,
  opensPersonPage,
  roleLabel,
  sortMembers,
  type TeamMember,
} from "../domain/members";
import { offerableJobTitles } from "../domain/job-titles";
import { emailChangedNewAddressEmail, emailChangedOldAddressEmail } from "../domain/email-change";
import {
  addFreelancerSchema,
  changeCoordinatorSchema,
  changeMemberEmailSchema,
  deactivateMemberSchema,
  inviteEmployeeSchema,
  inviteMemberSchema,
  reactivateSchema,
  updateMemberSchema,
  updateOwnProfileSchema,
} from "../domain/schemas";

function member(overrides: Partial<TeamMember>): TeamMember {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    fullName: "Someone",
    email: null,
    phone: null,
    role: "staff",
    status: "active",
    engagement: "permanent",
    jobTitleId: null,
    jobTitle: null,
    avatarFileId: null,
    invitedAt: null,
    joinedAt: "2026-09-22T00:00:00Z",
    createdAt: "2026-09-22T00:00:00Z",
    ...overrides,
  };
}

describe("inviteMemberSchema", () => {
  it("normalises the email, trims the name and turns an empty job title into null", () => {
    const parsed = inviteMemberSchema.parse({
      email: " New.Person@Example.com ",
      fullName: "  New Person ",
      role: "staff",
      jobTitleId: "",
    });
    expect(parsed).toEqual({
      email: "new.person@example.com",
      fullName: "New Person",
      role: "staff",
      jobTitleId: null,
    });
  });

  it("refuses the Owner role, a bad email and an empty name", () => {
    expect(
      inviteMemberSchema.safeParse({ email: "a@b.co", fullName: "A", role: "owner" }).success,
    ).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ email: "not-an-email", fullName: "A", role: "staff" }).success,
    ).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ email: "a@b.co", fullName: "  ", role: "staff" }).success,
    ).toBe(false);
  });
});

describe("the other schemas", () => {
  it("lets the role be absent on an edit (the Owner row) and validates a job title id", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      updateMemberSchema.parse({ memberId: id, fullName: "X", jobTitleId: id }).role,
    ).toBeUndefined();
    expect(
      updateMemberSchema.safeParse({ memberId: id, fullName: "X", jobTitleId: "nope" }).success,
    ).toBe(false);
  });

  it("stores an empty phone as null and refuses a two-character one", () => {
    expect(updateOwnProfileSchema.parse({ fullName: "Me", phone: " " }).phone).toBeNull();
    expect(updateOwnProfileSchema.parse({ fullName: "Me", phone: "9000000001" }).phone).toBe(
      "9000000001",
    );
    expect(updateOwnProfileSchema.safeParse({ fullName: "Me", phone: "12" }).success).toBe(false);
  });

  it("keeps the deactivation reason optional and capped", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(deactivateMemberSchema.parse({ memberId: id }).reason).toBeNull();
    expect(deactivateMemberSchema.parse({ memberId: id, reason: " Left " }).reason).toBe("Left");
    expect(
      deactivateMemberSchema.safeParse({ memberId: id, reason: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});

describe("memberActions", () => {
  const viewer = { id: "owner-id", canManage: true };

  it("offers nothing to someone without team.manage", () => {
    expect(Object.values(memberActions({ id: "x", canManage: false }, member({})))).not.toContain(
      true,
    );
  });

  it("offers the invite controls on an invited row and deactivate on an active one", () => {
    expect(memberActions(viewer, member({ status: "invited" }))).toMatchObject({
      copyInviteLink: true,
      revokeInvite: true,
      deactivate: false,
      reactivate: false,
      edit: true,
    });
    expect(memberActions(viewer, member({ status: "active" }))).toMatchObject({
      copyInviteLink: false,
      revokeInvite: false,
      deactivate: true,
      reactivate: false,
    });
    expect(memberActions(viewer, member({ status: "deactivated" }))).toMatchObject({
      edit: false,
      deactivate: false,
      reactivate: true,
    });
  });

  it("offers the sign-in change on any open row, the Owner's own included (PERMISSIONS 3)", () => {
    expect(memberActions(viewer, member({ status: "active" })).changeEmail).toBe(true);
    expect(memberActions(viewer, member({ status: "invited" })).changeEmail).toBe(true);
    expect(memberActions(viewer, member({ id: "owner-id", role: "owner" })).changeEmail).toBe(true);
    expect(memberActions(viewer, member({ status: "deactivated" })).changeEmail).toBe(false);
    expect(memberActions({ id: "x", canManage: false }, member({})).changeEmail).toBe(false);
  });

  it("never lets the Owner deactivate themselves or change their own role", () => {
    const actions = memberActions(viewer, member({ id: "owner-id", role: "owner" }));
    // Their own name and phone are edited on /me (3.4, kickoff 3).
    expect(actions).toMatchObject({ edit: false, editRole: false, deactivate: false });
  });

  it("opens every person's page except the Owner's own, which is /me (3.4)", () => {
    expect(opensPersonPage({ id: "owner-id" }, { id: "owner-id", role: "owner" })).toBe(false);
    expect(opensPersonPage({ id: "owner-id" }, { id: "a", role: "staff" })).toBe(true);
    expect(opensPersonPage({ id: "admin-id" }, { id: "owner-id", role: "owner" })).toBe(true);
    expect(opensPersonPage({ id: "admin-id" }, { id: "admin-id", role: "admin" })).toBe(true);
  });

  it("gives attendance only to someone who joined and is not the Owner (2.4)", () => {
    expect(hasAttendance({ role: "staff", joinedAt: "2026-09-01T00:00:00Z" })).toBe(true);
    expect(hasAttendance({ role: "staff", joinedAt: null })).toBe(false);
    expect(hasAttendance({ role: "owner", joinedAt: "2026-09-01T00:00:00Z" })).toBe(false);
  });

  it("gives a freelancer no attendance, leave or month (ADR-0013)", () => {
    expect(
      hasAttendance({ role: "staff", joinedAt: "2026-09-01T00:00:00Z", engagement: "freelance" }),
    ).toBe(false);
  });
});

describe("a freelancer's actions and words (ADR-0013, 4C)", () => {
  const viewer = { id: "owner-id", canManage: true };
  const freelancer = member({ engagement: "freelance" });

  it("changes the coordinator, invites as employee, never the sign-in email or the role", () => {
    expect(memberActions(viewer, freelancer)).toMatchObject({
      edit: true,
      editRole: false,
      changeEmail: false,
      changeCoordinator: true,
      inviteAsEmployee: true,
      deactivate: true,
    });
  });

  it("keeps Change coordinator on a deactivated freelancer, to prepare a return", () => {
    expect(
      memberActions(viewer, member({ engagement: "freelance", status: "deactivated" })),
    ).toMatchObject({ changeCoordinator: true, inviteAsEmployee: false, reactivate: true });
  });

  it("offers neither to an employee, nor anything to an Admin", () => {
    expect(memberActions(viewer, member({}))).toMatchObject({
      changeCoordinator: false,
      inviteAsEmployee: false,
    });
    expect(Object.values(memberActions({ id: "x", canManage: false }, freelancer))).not.toContain(
      true,
    );
  });

  it("names the role Freelancer, and the coordinator beside it", () => {
    expect(roleLabel(freelancer)).toBe("Freelancer");
    expect(roleLabel(member({ role: "admin" }))).toBe("Admin");
    expect(freelancerLine("Ravi")).toBe("Freelancer · with Ravi");
    expect(freelancerLine(null)).toBe("Freelancer");
  });

  it("lets only an active employee, Admin or Staff, coordinate (Kickoff 4 decision 8)", () => {
    const options = coordinatorOptions(
      [
        member({ id: "o", fullName: "Owen", role: "owner" }),
        member({ id: "a", fullName: "Zara", role: "admin" }),
        member({ id: "s", fullName: "Bea" }),
        member({ id: "i", fullName: "Ivy", status: "invited" }),
        member({ id: "d", fullName: "Dan", status: "deactivated" }),
        member({ id: "f", fullName: "Fay", engagement: "freelance" }),
        member({ id: "x", fullName: "Xan" }),
      ],
      ["x"],
    );
    expect(options).toEqual([
      { id: "s", name: "Bea" },
      { id: "a", name: "Zara" },
    ]);
  });
});

describe("the freelancer schemas", () => {
  const id = "00000000-0000-4000-8000-000000000002";

  it("needs a coordinator for a new freelancer, and trims the rest", () => {
    expect(addFreelancerSchema.safeParse({ fullName: "Asha", coordinatorId: "" }).success).toBe(
      false,
    );
    const parsed = addFreelancerSchema.parse({
      fullName: "  Asha  ",
      coordinatorId: id,
      jobTitleId: "",
      phone: " ",
    });
    expect(parsed).toMatchObject({ fullName: "Asha", coordinatorId: id });
  });

  it("keeps a change's reason optional and bounded", () => {
    expect(changeCoordinatorSchema.parse({ memberId: id, coordinatorId: id }).reason).toBeNull();
    expect(
      changeCoordinatorSchema.parse({ memberId: id, coordinatorId: id, reason: " moved " }).reason,
    ).toBe("moved");
    expect(
      changeCoordinatorSchema.safeParse({
        memberId: id,
        coordinatorId: id,
        reason: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });

  it("asks an email of an invite as employee, and a coordinator of a reactivation only if given", () => {
    expect(inviteEmployeeSchema.safeParse({ memberId: id, email: "nope" }).success).toBe(false);
    expect(inviteEmployeeSchema.parse({ memberId: id, email: "Asha@Example.com" }).email).toBe(
      "asha@example.com",
    );
    expect(reactivateSchema.parse({ memberId: id })).toEqual({ memberId: id });
  });

  it("carries a coordinator's freelancers with their deactivation", () => {
    const parsed = deactivateMemberSchema.parse({
      memberId: id,
      freelancers: [{ memberId: id, coordinatorId: id }],
    });
    expect(parsed.freelancers).toEqual([{ memberId: id, coordinatorId: id }]);
  });
});

describe("sortMembers", () => {
  it("puts the Owner first, then active, invited, deactivated, by name", () => {
    const sorted = sortMembers([
      member({ id: "1", fullName: "Zed", status: "deactivated" }),
      member({ id: "2", fullName: "Bea", status: "invited" }),
      member({ id: "3", fullName: "Cal" }),
      member({ id: "4", fullName: "Amy" }),
      member({ id: "5", fullName: "Owen", role: "owner" }),
    ]);
    expect(sorted.map((m) => m.fullName)).toEqual(["Owen", "Amy", "Cal", "Bea", "Zed"]);
  });
});

describe("invite link and email", () => {
  it("builds the token-hash route on the given origin, as an invite or a recovery link", () => {
    expect(inviteLinkFor("https://maxoff.app/", "abc def")).toBe(
      "https://maxoff.app/auth/confirm?token_hash=abc+def&type=invite",
    );
    expect(inviteLinkFor("https://maxoff.app", "x", "recovery")).toBe(
      "https://maxoff.app/auth/confirm?token_hash=x&type=recovery",
    );
  });

  it("names the inviter, carries the link and escapes html", () => {
    const mail = inviteEmail({
      to: "new@example.com",
      inviteeName: "<New>",
      inviterName: "Prishit",
      link: "https://maxoff.app/auth/confirm?token_hash=x&type=invite",
    });
    expect(mail.subject).toBe("Prishit invited you to MaxOff");
    expect(mail.text).toContain("https://maxoff.app/auth/confirm?token_hash=x&type=invite");
    expect(mail.html).toContain("&lt;New&gt;");
    expect(mail.html).toContain(
      'href="https://maxoff.app/auth/confirm?token_hash=x&amp;type=invite"',
    );
  });
});

describe("resolveAppOrigin", () => {
  it("prefers the configured URL, then the request host, then localhost", () => {
    expect(resolveAppOrigin("https://maxoff.app/some/path", "evil.example", "https")).toBe(
      "https://maxoff.app",
    );
    expect(resolveAppOrigin(undefined, "localhost:3100", null)).toBe("http://localhost:3100");
    expect(resolveAppOrigin(undefined, "staging.example", "https")).toBe("https://staging.example");
    expect(resolveAppOrigin("not a url", null, null)).toBe("http://localhost:3000");
  });

  it("falls back to the request only on a local run; staging and production fail loud", () => {
    expect(resolveAppOrigin(undefined, "localhost:3100", null, "local")).toBe(
      "http://localhost:3100",
    );
    expect(() => resolveAppOrigin(undefined, "evil.example", "https", "staging")).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
    expect(() => resolveAppOrigin("not a url", "evil.example", "https", "production")).toThrow();
    expect(resolveAppOrigin("https://maxoff.app", "evil.example", "https", "production")).toBe(
      "https://maxoff.app",
    );
  });
});

describe("changeMemberEmailSchema", () => {
  it("trims and lower-cases the address", () => {
    expect(
      changeMemberEmailSchema.parse({
        memberId: "00000000-0000-4000-8000-000000000001",
        email: "  New.Address@Example.com ",
      }).email,
    ).toBe("new.address@example.com");
  });

  it("refuses something that is not an address", () => {
    const input = { memberId: "00000000-0000-4000-8000-000000000001", email: "not-an-email" };
    expect(changeMemberEmailSchema.safeParse(input).success).toBe(false);
  });
});

describe("the email-change notices", () => {
  const notice = {
    memberName: "Asha",
    oldEmail: "old@example.com",
    newEmail: "new@example.com",
    changedBy: "Prishit",
    accepted: true,
  };

  it("tells the new address it is the sign-in from now on", () => {
    const mail = emailChangedNewAddressEmail(notice);
    expect(mail.to).toBe("new@example.com");
    expect(mail.text).toContain("new@example.com");
    expect(mail.text).toContain("Prishit");
    expect(mail.text).toContain("existing password");
  });

  it("promises an invited person a fresh link instead of a password they don't have", () => {
    const mail = emailChangedNewAddressEmail({ ...notice, accepted: false });
    expect(mail.subject).toContain("invitation");
    expect(mail.text).not.toContain("existing password");
    expect(mail.text).toContain("fresh link");
    expect(mail.text).toContain("stopped working");
  });

  it("tells the old address that the login moved, and where to", () => {
    const mail = emailChangedOldAddressEmail(notice);
    expect(mail.to).toBe("old@example.com");
    expect(mail.text).toContain("new@example.com");
    expect(mail.text).toContain("no longer");
  });

  it("escapes what it puts in the HTML", () => {
    const mail = emailChangedNewAddressEmail({ ...notice, memberName: '<script>"x"' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("offerableJobTitles", () => {
  const options = [
    { id: "a", name: "Video Editor" },
    { id: "b", name: "Colorist", archived: true },
  ];

  it("hides an archived title from everyone who does not have it", () => {
    expect(offerableJobTitles(options, null).map((option) => option.id)).toEqual(["a"]);
    expect(offerableJobTitles(options, "a").map((option) => option.id)).toEqual(["a"]);
  });

  it("keeps the archived title of the member being edited (1.3 follow-up)", () => {
    expect(offerableJobTitles(options, "b").map((option) => option.id)).toEqual(["a", "b"]);
  });
});
