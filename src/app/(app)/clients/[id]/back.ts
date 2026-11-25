/** Clients is the parent; Today opens a client too, and back returns there (§14.2 k, 6b.12). */
export const CLIENT_BACK = {
  href: "/clients",
  label: "Clients",
  from: [{ path: "/today", label: "Today" }],
};
