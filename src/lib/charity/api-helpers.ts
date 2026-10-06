import { NextResponse } from "next/server";
import type { CharityGateResult } from "@/lib/charity/feature-gate";

/**
 * Map a charity-gate failure to a uniform JSON response.
 * 404 for missing tenant; 403 with explanatory body for the others so the
 * UI can render a useful message ("not supported in your region", "ask
 * your platform admin to enable the feature").
 */
export function charityGateError(result: CharityGateResult): NextResponse | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "TENANT_NOT_FOUND":
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    case "COUNTRY_UNSUPPORTED":
      return NextResponse.json(
        {
          error: "CHARITY_COUNTRY_UNSUPPORTED",
          message: `Charity Accounts is not available in country '${result.country}'.`,
        },
        { status: 403 },
      );
    case "FEATURE_DISABLED":
      return NextResponse.json(
        {
          error: "CHARITY_FEATURE_DISABLED",
          message: "Charity Accounts is not enabled for this club.",
        },
        { status: 403 },
      );
  }
}
