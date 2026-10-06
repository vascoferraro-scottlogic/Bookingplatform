import { Permission } from "@prisma/client";

export { Permission };

/**
 * All platform-defined permissions, grouped by domain.
 * Client-safe — no Prisma client or Node built-ins imported.
 * Used by the groups UI (C3) to render the permission grid.
 */
export const PERMISSION_DOMAINS: Record<string, { label: string; permissions: Permission[] }> = {
  bookings: {
    label: "Bookings",
    permissions: [
      Permission.bookings_view,
      Permission.bookings_create,
      Permission.bookings_manage,
      Permission.bookings_admin_override,
    ],
  },
  maintenance: {
    label: "Maintenance",
    permissions: [
      Permission.maintenance_view,
      Permission.maintenance_create,
      Permission.maintenance_assign,
      Permission.maintenance_close,
    ],
  },
  events: {
    label: "Events",
    permissions: [
      Permission.events_view,
      Permission.events_create,
      Permission.events_manage,
    ],
  },
  messaging: {
    label: "Messaging",
    permissions: [
      Permission.messaging_view,
      Permission.messaging_send,
      Permission.messaging_manage_channels,
    ],
  },
  content: {
    label: "Content",
    permissions: [
      Permission.content_view,
      Permission.content_edit,
      Permission.content_publish,
    ],
  },
  greens: {
    label: "Greens",
    permissions: [
      Permission.greens_view,
      Permission.greens_manage,
    ],
  },
  streaming: {
    label: "Streaming",
    permissions: [
      Permission.streaming_view,
      Permission.streaming_manage,
    ],
  },
  charity: {
    label: "Charity Accounts",
    permissions: [
      Permission.charity_view,
      Permission.charity_edit,
      Permission.charity_finalise_tar,
      Permission.charity_manage_funds,
    ],
  },
  analytics: {
    label: "Analytics",
    permissions: [Permission.analytics_view],
  },
  audit: {
    label: "Audit",
    permissions: [Permission.audit_view],
  },
  help: {
    label: "Help",
    permissions: [
      Permission.help_view,
      Permission.help_manage_overrides,
    ],
  },
  users: {
    label: "Users & Members",
    permissions: [
      Permission.users_view,
      Permission.users_invite,
      Permission.users_manage,
    ],
  },
  settings: {
    label: "Settings",
    permissions: [
      Permission.settings_view,
      Permission.settings_edit,
    ],
  },
  billing: {
    label: "Billing",
    permissions: [
      Permission.billing_view,
      Permission.billing_manage,
    ],
  },
  agents: {
    label: "Agents",
    permissions: [
      Permission.agents_view,
      Permission.agents_configure,
      Permission.agents_review_proposals,
    ],
  },
  notifications: {
    label: "Notifications",
    permissions: [
      Permission.notifications_view,
      Permission.notifications_manage,
    ],
  },
  federation: {
    label: "Federation",
    permissions: [
      Permission.federation_book_at_partners,
      Permission.federation_manage,
    ],
  },
  funding: {
    label: "Funding",
    permissions: [
      Permission.funding_view,
      Permission.funding_manage,
    ],
  },
};

/** All permissions as a flat array (convenience). */
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_DOMAINS).flatMap(
  (d) => d.permissions,
);
