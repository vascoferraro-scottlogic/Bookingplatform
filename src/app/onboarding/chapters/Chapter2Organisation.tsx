"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

type Country = "GB" | "NI" | "OTHER";
type OrgType =
  | "REGISTERED_CHARITY"
  | "CIO"
  | "SCIO"
  | "CASC"
  | "COMMUNITY_INTEREST_COMPANY"
  | "LIMITED_COMPANY"
  | "UNINCORPORATED_ASSOCIATION"
  | "PRIVATE_MEMBERS_CLUB"
  | "OTHER"
  | "NOT_CONSTITUTED";

type VerticalValue = "BOWLS" | "GOLF" | "CRICKET" | "MULTI_SPORT" | "CHARITY_ADMIN" | "OTHER";

const VERTICALS: Array<{ value: VerticalValue; label: string; desc: string }> = [
  { value: "BOWLS", label: "Bowls club", desc: "Lawn bowls, indoor bowls, or crown green." },
  { value: "GOLF", label: "Golf club", desc: "Golf course, driving range, or golf society." },
  { value: "CRICKET", label: "Cricket club", desc: "Any cricket club or ground." },
  { value: "MULTI_SPORT", label: "Multi-sport / leisure", desc: "Mixed-sport facility, sports centre, or leisure trust." },
  { value: "CHARITY_ADMIN", label: "Charity — admin & funding only", desc: "You use the platform for charity governance, grant applications, and accounts — no facility bookings." },
  { value: "OTHER", label: "Other", desc: "Something else — tell us via support." },
];

const ORG_TYPES: Array<{
  value: OrgType;
  label: string;
  blurb: string;
  helpSlug?: string; // article under content/help/en/getting-started/legal-forms/
}> = [
  {
    value: "REGISTERED_CHARITY",
    label: "Registered charity",
    blurb: "Registered with the Charity Commission (E&W), OSCR (Scotland), or CCNI (NI).",
    helpSlug: "registered-charity",
  },
  {
    value: "CIO",
    label: "Charitable Incorporated Organisation (CIO)",
    blurb: "Incorporated charity in England & Wales — limited liability for trustees.",
    helpSlug: "cio",
  },
  {
    value: "SCIO",
    label: "Scottish Charitable Incorporated Organisation (SCIO)",
    blurb: "Scottish equivalent of a CIO, regulated by OSCR.",
    helpSlug: "scio",
  },
  {
    value: "CASC",
    label: "Community Amateur Sports Club (CASC)",
    blurb: "Not a charity, but enjoys Gift Aid and rates relief. Common for sports clubs.",
    helpSlug: "casc",
  },
  {
    value: "COMMUNITY_INTEREST_COMPANY",
    label: "Community Interest Company (CIC)",
    blurb: "Limited company with an asset lock and community-purpose statement.",
    helpSlug: "cic",
  },
  {
    value: "LIMITED_COMPANY",
    label: "Limited company (non-charitable)",
    blurb: "Companies House registered, trading commercially.",
    helpSlug: "limited-company",
  },
  {
    value: "UNINCORPORATED_ASSOCIATION",
    label: "Unincorporated association",
    blurb: "Most common starting form — but trustees carry personal liability.",
    helpSlug: "unincorporated-association",
  },
  {
    value: "PRIVATE_MEMBERS_CLUB",
    label: "Private members' club",
    blurb: "Non-charitable members' club. Funding routes are different from charities.",
    helpSlug: "private-members-club",
  },
  { value: "OTHER", label: "Other", blurb: "Tell us via support and we'll add it." },
  {
    value: "NOT_CONSTITUTED",
    label: "Not yet constituted",
    blurb: "You haven't formally set up the club yet.",
    helpSlug: "not-constituted",
  },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Chapter 2 — Your organisation. KYC + jurisdiction capture.
 *
 * Persists country, organisation type, and financial year-end via
 * /api/onboarding/organisation, which also auto-enables the `charity` flag
 * + seeds CharitySettings for charity-style orgs in supported jurisdictions.
 *
 * Live advice callout switches on the selected org type, linking to a
 * tailored help article. Strongest variant is for NOT_CONSTITUTED.
 *
 * See plan: /memories/session/plan.md (Onboarding KYC).
 */
export default function Chapter2Organisation({ tenantId, onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [country, setCountry] = useState<Country>("GB");
  const [orgType, setOrgType] = useState<OrgType | "">("");
  const [vertical, setVertical] = useState<VerticalValue>("BOWLS");
  const [yearEndMonth, setYearEndMonth] = useState(3);
  const [yearEndDay, setYearEndDay] = useState(31);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((t) => {
        if (t.country) setCountry(t.country);
        if (t.organisationType) setOrgType(t.organisationType);
        if (t.vertical) setVertical(t.vertical as VerticalValue);
        if (typeof t.financialYearEndMonth === "number") setYearEndMonth(t.financialYearEndMonth);
        if (typeof t.financialYearEndDay === "number") setYearEndDay(t.financialYearEndDay);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tenantId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !orgType) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/onboarding/organisation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country,
        organisationType: orgType,
        financialYearEndMonth: yearEndMonth,
        financialYearEndDay: yearEndDay,
        vertical,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save your organisation details.");
      return;
    }
    await onAdvance();
  };

  if (!loaded) return <div className="text-gray-500">{t("loading")}</div>;

  const selected = ORG_TYPES.find((o) => o.value === orgType);
  const charityStyle =
    orgType === "REGISTERED_CHARITY" ||
    orgType === "CIO" ||
    orgType === "SCIO" ||
    orgType === "CASC";
  const supportedCountry = country === "GB" || country === "NI";
  const willEnableCharity = charityStyle && supportedCountry;

  // Day-cap by month (Feb 28; Apr/Jun/Sep/Nov 30; rest 31). Keeps the picker
  // honest without us having to handle leap years for an annual cycle.
  const maxDay =
    yearEndMonth === 2 ? 28 :
    [4, 6, 9, 11].includes(yearEndMonth) ? 30 : 31;
  const cappedDay = Math.min(yearEndDay, maxDay);

  return (
    <ChapterShell
      title={t("chapters.organisation")}
      intro="A few questions to tailor the platform — accounts features, advice, and reporting periods all flow from here."
      onSubmit={submit}
      busy={busy}
    >
      {/* Vertical (capability preset) — asked first so downstream chapters adapt */}
      <Field label="What will you use the platform for?" hint="This sets which capabilities are turned on. You can adjust individual features later.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VERTICALS.map((v) => (
            <label
              key={v.value}
              className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer ${
                vertical === v.value ? "border-emerald-600 bg-emerald-50" : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <input
                type="radio"
                name="vertical"
                value={v.value}
                checked={vertical === v.value}
                onChange={() => setVertical(v.value)}
                className="mt-0.5 text-emerald-600"
              />
              <span>
                <span className="block font-medium text-sm">{v.label}</span>
                <span className="block text-xs text-gray-500">{v.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Where is your organisation based?" hint="Determines which jurisdiction-specific features are available.">
        <div className="flex gap-3 flex-wrap">
          {(["GB", "NI", "OTHER"] as Country[]).map((c) => (
            <label
              key={c}
              className={`flex items-center gap-2 px-4 py-2 rounded-md border cursor-pointer ${
                country === c ? "border-emerald-600 bg-emerald-50" : "border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="country"
                value={c}
                checked={country === c}
                onChange={() => setCountry(c)}
                className="text-emerald-600"
              />
              <span>{c === "GB" ? "Great Britain" : c === "NI" ? "Northern Ireland" : "Elsewhere"}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="What is your club's legal form?"
        hint="If you're not sure, pick the closest match — you can change this later in settings."
      >
        <select
          required
          className={inputClass}
          value={orgType}
          onChange={(e) => setOrgType(e.target.value as OrgType)}
        >
          <option value="" disabled>— select —</option>
          {ORG_TYPES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {selected && <p className="text-xs text-gray-500 mt-1">{selected.blurb}</p>}
      </Field>

      <Field label="Financial year end" hint="The last day of your financial year. 31 March is the most common for UK clubs.">
        <div className="flex gap-2 items-center">
          <select
            className={inputClass}
            value={yearEndMonth}
            onChange={(e) => {
              const m = Number(e.target.value);
              setYearEndMonth(m);
              const newMax = m === 2 ? 28 : [4, 6, 9, 11].includes(m) ? 30 : 31;
              if (yearEndDay > newMax) setYearEndDay(newMax);
            }}
            style={{ maxWidth: "12rem" }}
          >
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>{label}</option>
            ))}
          </select>
          <select
            className={inputClass}
            value={cappedDay}
            onChange={(e) => setYearEndDay(Number(e.target.value))}
            style={{ maxWidth: "6rem" }}
          >
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </Field>

      {/* Live advice callout switching on org type */}
      {selected && (
        <Advice
          orgType={orgType as OrgType}
          willEnableCharity={willEnableCharity}
          country={country}
          helpSlug={selected.helpSlug}
        />
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      )}
    </ChapterShell>
  );
}

function Advice({
  orgType,
  willEnableCharity,
  country,
  helpSlug,
}: {
  orgType: OrgType;
  willEnableCharity: boolean;
  country: Country;
  helpSlug?: string;
}) {
  const helpHref = helpSlug ? `/dashboard/help/article/legal-form-${helpSlug}` : null;

  // Distinct visual treatments by severity / nature of advice. NOT_CONSTITUTED
  // is the loud one because it's the highest-risk state for the trustees.
  if (orgType === "NOT_CONSTITUTED") {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Get constituted before you raise money.</p>
        <p className="mt-2">
          Running a club without a legal form means contracts, grants, and even bank
          accounts sit in someone&apos;s personal name. The usual next step is an
          unincorporated association (free, easy) → CIO/SCIO (limited liability,
          unlocks more grants). We&apos;ve written a starter guide for you.
        </p>
        {helpHref && (
          <a href={helpHref} className="inline-block mt-2 underline font-medium">
            Read: How to constitute your club →
          </a>
        )}
      </div>
    );
  }

  if (willEnableCharity) {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">We&apos;ll set up charity accounting for you.</p>
        <p className="mt-2">
          When you save, the Charity Accounts module will be enabled with a
          chart of accounts pre-populated for bowling clubs. You&apos;ll find
          it in the dashboard sidebar after this step.
        </p>
        {helpHref && (
          <a href={helpHref} className="inline-block mt-2 underline font-medium">
            Read more about your form →
          </a>
        )}
      </div>
    );
  }

  if (orgType === "UNINCORPORATED_ASSOCIATION" && country !== "OTHER") {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Worth knowing about your form.</p>
        <p className="mt-2">
          Unincorporated associations are the easiest to start — but trustees
          are personally liable for debts and contracts. Many clubs convert to
          a CIO (E&amp;W) or SCIO (Scotland) once they&apos;re raising material
          sums.
        </p>
        {helpHref && (
          <a href={helpHref} className="inline-block mt-2 underline font-medium">
            Read about unincorporated associations →
          </a>
        )}
      </div>
    );
  }

  if (helpHref) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
        <p>
          Funding routes and reporting expectations differ by form.{" "}
          <a href={helpHref} className="underline font-medium">
            Read about your form →
          </a>
        </p>
      </div>
    );
  }

  return null;
}
