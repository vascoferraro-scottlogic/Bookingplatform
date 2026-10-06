"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import TenantSwitcher from "@/components/TenantSwitcher";

type ActingAs = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
  impersonationId: string;
  startedAt: string;
} | null | undefined;

// Paths a non-impersonating platform admin is allowed to visit inside /dashboard.
const PLATFORM_ALLOWED_PREFIXES = ["/dashboard/platform"];
const PLATFORM_ALLOWED_EXACT = new Set(["/dashboard"]);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? "/dashboard";
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [charityAvailable, setCharityAvailable] = useState(false);
  const [showWeatherBanner, setShowWeatherBanner] = useState(false);
  const [federationEnabled, setFederationEnabled] = useState(false);
  const [fundingEnabled, setFundingEnabled] = useState(false);
  const [insightsEnabled, setInsightsEnabled] = useState(false);
  const [bookingsEnabled, setBookingsEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);

  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs as ActingAs;
  const isPlatformAdmin = role === "PLATFORM_ADMIN";
  const isImpersonating = !!acting;
  const effectiveRole = isImpersonating ? acting!.role : role;
  const inPlatformMode = isPlatformAdmin && !isImpersonating;
  const inTenantMode = !inPlatformMode;
  const isTenantAdminEffective = effectiveRole === "TENANT_ADMIN";
  const isMaintenanceEffective = effectiveRole === "MAINTENANCE" || effectiveRole === "TENANT_ADMIN";

  useEffect(() => {
    if (status !== "authenticated") return;
    if (inPlatformMode) {
      const allowed =
        PLATFORM_ALLOWED_EXACT.has(pathname) ||
        PLATFORM_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) {
        router.replace("/dashboard");
      }
      return;
    }

    fetch("/api/notifications?unread=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((n) => setUnread(Array.isArray(n) ? n.length : 0))
      .catch(() => {});
    fetch("/api/features")
      .then((r) => (r.ok ? r.json() : null))
      .then((flags) => {
        setEventsEnabled(!!(flags && flags.events));
        setFederationEnabled(!!(flags && flags.federation));
        setInsightsEnabled(!!(flags && flags.businessInsights));
        setBookingsEnabled(!!(flags && flags.bookings));
        setAgentEnabled(!!(flags && flags.agent));
      })
      .catch(() => {});
    if (isTenantAdminEffective) {
      fetch("/api/tracking/stats?period=7d")
        .then((r) => { if (r.ok) setAnalyticsEnabled(true); })
        .catch(() => {});
      fetch("/api/charity/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (s && s.available) setCharityAvailable(true); })
        .catch(() => {});
      fetch("/api/funding/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (s && s.available) setFundingEnabled(true); })
        .catch(() => {});
      fetch("/api/bookings/weather?date=" + new Date().toISOString().slice(0, 10))
        .then((r) => r.json())
        .then((d) => {
          if (d && d.available === false) setShowWeatherBanner(true);
        })
        .catch(() => {});
    }
  }, [status, inPlatformMode, isTenantAdminEffective, pathname, router]);

  return (
    <div className="min-h-screen flex flex-col">
      {!inPlatformMode && (
        <div className="bg-white border-b px-4 py-2 flex items-center justify-end">
          <TenantSwitcher />
        </div>
      )}
      <div className="flex flex-1">
        <aside className={`w-56 ${inPlatformMode ? "bg-slate-800" : "bg-green-800"} text-white flex flex-col p-4 gap-2`}>
          <h2 className="text-lg font-bold mb-4">
            {inPlatformMode ? "Platform Console" : "Management Platform"}
          </h2>

          {inPlatformMode ? (
            <>
              <Link href="/dashboard" className="hover:bg-slate-700 rounded px-3 py-2">Overview</Link>
              <Link href="/dashboard/platform/applications" className="hover:bg-slate-700 rounded px-3 py-2">Applications</Link>
              <Link href="/dashboard/platform/tenants" className="hover:bg-slate-700 rounded px-3 py-2">Tenants</Link>
              <Link href="/dashboard/platform/payments" className="hover:bg-slate-700 rounded px-3 py-2">Payments</Link>
              <Link href="/dashboard/platform/finance" className="hover:bg-slate-700 rounded px-3 py-2">Finance</Link>
              <Link href="/dashboard/platform/costs" className="hover:bg-slate-700 rounded px-3 py-2">Agent Costs</Link>
              <Link href="/dashboard/platform/model-health" className="hover:bg-slate-700 rounded px-3 py-2">Model Health</Link>
              <Link href="/dashboard/platform/insights" className="hover:bg-slate-700 rounded px-3 py-2">Insights</Link>
              <Link href="/dashboard/platform/outbound" className="hover:bg-slate-700 rounded px-3 py-2">Outbound</Link>
              <Link href="/dashboard/platform/audit" className="hover:bg-slate-700 rounded px-3 py-2">Platform Audit</Link>
              <Link href="/dashboard/platform/impersonations" className="hover:bg-slate-700 rounded px-3 py-2">Impersonation History</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard" className="hover:bg-green-700 rounded px-3 py-2">Dashboard</Link>
              {bookingsEnabled && <Link href="/dashboard/bookings" className="hover:bg-green-700 rounded px-3 py-2">Bookings</Link>}
              {eventsEnabled && <Link href="/dashboard/events" className="hover:bg-green-700 rounded px-3 py-2">Events</Link>}
              {agentEnabled && <Link href="/dashboard/maintenance" className="hover:bg-green-700 rounded px-3 py-2">Maintenance</Link>}
              {agentEnabled && isMaintenanceEffective && <Link href="/dashboard/agents" className="hover:bg-green-700 rounded px-3 py-2">🤖 Agents</Link>}
              {agentEnabled && isMaintenanceEffective && <Link href="/dashboard/agents/inbox" className="hover:bg-green-700 rounded px-3 py-2">📥 Agent Inbox</Link>}
              <Link href="/dashboard/messaging" className="hover:bg-green-700 rounded px-3 py-2">Messaging</Link>
              <Link href="/dashboard/notifications" className="hover:bg-green-700 rounded px-3 py-2 flex justify-between">
                Notifications
                {unread > 0 && <span className="bg-red-500 text-xs rounded-full px-2 py-0.5">{unread}</span>}
              </Link>
              {isTenantAdminEffective && <Link href="/dashboard/content" className="hover:bg-green-700 rounded px-3 py-2">Content</Link>}
              {isTenantAdminEffective && bookingsEnabled && <Link href="/dashboard/greens" className="hover:bg-green-700 rounded px-3 py-2">Greens</Link>}
              {isTenantAdminEffective && charityAvailable && <Link href="/dashboard/charity" className="hover:bg-green-700 rounded px-3 py-2">💷 Charity</Link>}
              {isTenantAdminEffective && fundingEnabled && <Link href="/dashboard/funding" className="hover:bg-green-700 rounded px-3 py-2">📋 Funding</Link>}
              {isTenantAdminEffective && bookingsEnabled && <Link href="/dashboard/admin" className="hover:bg-green-700 rounded px-3 py-2">Booking Admin</Link>}
              {isTenantAdminEffective && <Link href="/dashboard/users" className="hover:bg-green-700 rounded px-3 py-2">Users</Link>}
              {isTenantAdminEffective && <Link href="/dashboard/settings" className="hover:bg-green-700 rounded px-3 py-2">Settings</Link>}
              {isTenantAdminEffective && <Link href="/dashboard/settings/groups" className="hover:bg-green-700 rounded px-3 py-2">Groups</Link>}
              {isTenantAdminEffective && federationEnabled && <Link href="/dashboard/federation" className="hover:bg-green-700 rounded px-3 py-2">Federation</Link>}
              {isTenantAdminEffective && <Link href="/dashboard/billing" className="hover:bg-green-700 rounded px-3 py-2">Billing</Link>}
              <Link href="/dashboard/audit" className="hover:bg-green-700 rounded px-3 py-2">
                {isTenantAdminEffective ? "Audit Log" : "My Activity"}
              </Link>
              {insightsEnabled && <Link href="/dashboard/insights" className="hover:bg-green-700 rounded px-3 py-2">📊 Insights</Link>}
              {analyticsEnabled && <Link href="/dashboard/analytics" className="hover:bg-green-700 rounded px-3 py-2">Analytics</Link>}
              {isTenantAdminEffective && <Link href="/dashboard/help" className="hover:bg-green-700 rounded px-3 py-2">Help</Link>}
            </>
          )}

          <div className="mt-auto">
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className={`w-full text-left rounded px-3 py-2 ${inPlatformMode ? "hover:bg-slate-700" : "hover:bg-green-700"}`}
            >
              Sign Out
            </button>
          </div>
        </aside>
        <main className="flex-1 p-6">
          {showWeatherBanner && inTenantMode && (
            <Link
              href="/dashboard/settings/location"
              className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-2 text-sm text-amber-800 hover:bg-amber-100"
            >
              <span>📍</span>
              <span>
                Set your venue location to enable weather forecasts on the booking page.
                <span className="ml-1 underline">Open settings →</span>
              </span>
            </Link>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
