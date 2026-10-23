import type { Vertical } from "@prisma/client";

/**
 * Capability flags a club gets from its vertical (FR-FLAG-004). Admin-only
 * organisations (CHARITY_ADMIN) run funding + charity accounts and no
 * bookings or maintenance agent; every sports vertical gets bookings + agent.
 * Applied on application approval, platform-admin tenant create and the
 * onboarding wizard.
 */
export function verticalFlagPreset(vertical: Vertical | null | undefined): Record<string, boolean> {
  if (vertical === "CHARITY_ADMIN") {
    return { bookings: false, agent: false, funding: true, charity: true };
  }
  return { bookings: true, agent: true };
}

/** The preset as `{ key, enabled }` rows, ready for featureFlag create/createMany. */
export function verticalFlagRows(vertical: Vertical | null | undefined) {
  return Object.entries(verticalFlagPreset(vertical)).map(([key, enabled]) => ({ key, enabled }));
}
