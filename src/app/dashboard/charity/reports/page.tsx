"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Year = {
  id: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "LOCKED";
  bankBalanceAtEnd: number | null;
};

type FundCol = { fundId: string; name: string; kind: string };
type CatRow = {
  categoryId: string;
  code: string;
  label: string;
  kind: "RECEIPT" | "PAYMENT";
  byFund: Record<string, number>;
  total: number;
};

type RP = {
  yearId: string;
  startDate: string;
  endDate: string;
  funds: FundCol[];
  receipts: CatRow[];
  payments: CatRow[];
  totalsByFund: Record<string, { receipts: number; payments: number; net: number }>;
  grandTotals: { receipts: number; payments: number; net: number };
};

type SoALRow = {
  id: string;
  kind:
    | "CASH"
    | "BANK"
    | "INVESTMENT"
    | "DEBTOR"
    | "FIXED_ASSET"
    | "OTHER_ASSET"
    | "CREDITOR"
    | "OTHER_LIABILITY";
  name: string;
  amount: number;
  notes: string | null;
};

type SoAL = {
  yearId: string;
  bankBalanceAtEnd: number | null;
  assets: SoALRow[];
  liabilities: SoALRow[];
  totalAssets: number;
  totalLiabilities: number;
  netAssets: number;
};

type ReportPayload = {
  year: Year;
  receiptsAndPayments: RP;
  statementOfAssetsAndLiabilities: SoAL;
};

const ASSET_KINDS: SoALRow["kind"][] = [
  "CASH",
  "BANK",
  "INVESTMENT",
  "DEBTOR",
  "FIXED_ASSET",
  "OTHER_ASSET",
];
const LIABILITY_KINDS: SoALRow["kind"][] = ["CREDITOR", "OTHER_LIABILITY"];

const KIND_LABEL: Record<SoALRow["kind"], string> = {
  CASH: "Cash",
  BANK: "Bank",
  INVESTMENT: "Investment",
  DEBTOR: "Debtor (owed to us)",
  FIXED_ASSET: "Fixed asset",
  OTHER_ASSET: "Other asset",
  CREDITOR: "Creditor (we owe)",
  OTHER_LIABILITY: "Other liability",
};

function pounds(p: number): string {
  return (p / 100).toFixed(2);
}

function poundsToPence(input: string): number | null {
  const cleaned = input.trim().replace(/[£,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export default function CharityReportsPage() {
  const t = useTranslations("charity");
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Bank balance entry
  const [bankBalanceInput, setBankBalanceInput] = useState("");

  // Asset/liability form
  const [alForm, setAlForm] = useState({
    kind: "BANK" as SoALRow["kind"],
    name: "",
    amount: "",
    notes: "",
  });

  useEffect(() => {
    fetch("/api/charity/years")
      .then((r) => (r.ok ? r.json() : []))
      .then((y: Year[]) => {
        setYears(y);
        if (y.length > 0) setYearId(y[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!yearId) return;
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId]);

  async function loadReport() {
    setRefreshing(true);
    setError("");
    const res = await fetch(`/api/charity/reports?yearId=${yearId}`);
    setRefreshing(false);
    if (!res.ok) {
      setError(`Failed to load report (${res.status})`);
      return;
    }
    const data: ReportPayload = await res.json();
    setReport(data);
    setBankBalanceInput(
      data.year.bankBalanceAtEnd != null ? pounds(data.year.bankBalanceAtEnd) : "",
    );
  }

  async function saveBankBalance() {
    if (!yearId) return;
    const pence = poundsToPence(bankBalanceInput);
    if (pence === null) {
      setError(t("reports.bankBalanceError"));
      return;
    }
    const res = await fetch(`/api/charity/years/${yearId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankBalanceAtEnd: pence }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    await loadReport();
  }

  async function addAssetLiability(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!yearId) return;
    const pence = poundsToPence(alForm.amount);
    if (pence === null || pence < 0) {
      setError("Amount must be a number ≥ 0");
      return;
    }
    const res = await fetch("/api/charity/asset-liabilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        financialYearId: yearId,
        kind: alForm.kind,
        name: alForm.name,
        amount: pence,
        notes: alForm.notes.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    setAlForm({ kind: alForm.kind, name: "", amount: "", notes: "" });
    await loadReport();
  }

  async function deleteAL(id: string) {
    if (!confirm("Delete this asset/liability line?")) return;
    const res = await fetch(`/api/charity/asset-liabilities/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    await loadReport();
  }

  function downloadCSV() {
    if (!yearId) return;
    window.open(`/api/charity/reports?yearId=${yearId}&format=csv`, "_blank");
  }

  const yearLocked = report?.year.status === "LOCKED";

  const visibleFunds = useMemo(() => report?.receiptsAndPayments.funds ?? [], [report]);

  if (loading) return <p>{t("overview.loading")}</p>;

  return (
    <div className="max-w-7xl">
      <div className="mb-4 text-sm">
        <Link href="/dashboard/charity" className="text-green-700 hover:underline">
          {t("reports.backToCharity")}
        </Link>
      </div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
        <div className="flex items-center gap-2">
          <select
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            {years.length === 0 && <option value="">{t("reports.noYears")}</option>}
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.startDate} → {y.endDate} {y.status === "LOCKED" ? "🔒" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={downloadCSV}
            disabled={!yearId}
            className="px-3 py-2 bg-green-700 text-white text-sm rounded disabled:opacity-50"
          >
            {t("reports.exportCsv")}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-4">
          {error}
        </div>
      )}

      {refreshing && <p className="text-sm text-slate-500 mb-2">{t("reports.refreshing")}</p>}

      {!report && yearId && !refreshing && (
        <p className="text-slate-600">{t("reports.noReportData")}</p>
      )}

      {report && (
        <>
          {/* Receipts & Payments */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">{t("reports.receiptsAndPayments")}</h2>
            <div className="bg-white border border-slate-200 rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 sticky left-0 bg-slate-50">{t("reports.code")}</th>
                    <th className="text-left px-3 py-2">{t("reports.category")}</th>
                    {visibleFunds.map((f) => (
                      <th key={f.fundId} className="text-right px-3 py-2">{f.name}</th>
                    ))}
                    <th className="text-right px-3 py-2 font-semibold">{t("reports.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-green-50 border-t border-slate-200">
                    <td colSpan={2 + visibleFunds.length + 1} className="px-3 py-1.5 font-semibold text-green-900">
                      {t("reports.receiptsHeader")}
                    </td>
                  </tr>
                  {report.receiptsAndPayments.receipts.map((r) => (
                    <tr key={r.categoryId} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-xs text-slate-500">{r.code}</td>
                      <td className="px-3 py-1.5">{r.label}</td>
                      {visibleFunds.map((f) => (
                        <td key={f.fundId} className="text-right px-3 py-1.5 tabular-nums">
                          {r.byFund[f.fundId] ? `£${pounds(r.byFund[f.fundId])}` : "—"}
                        </td>
                      ))}
                      <td className="text-right px-3 py-1.5 tabular-nums font-medium">
                        {r.total ? `£${pounds(r.total)}` : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                    <td className="px-3 py-1.5"></td>
                    <td className="px-3 py-1.5">Total receipts</td>
                    {visibleFunds.map((f) => (
                      <td key={f.fundId} className="text-right px-3 py-1.5 tabular-nums">
                        £{pounds(report.receiptsAndPayments.totalsByFund[f.fundId]?.receipts ?? 0)}
                      </td>
                    ))}
                    <td className="text-right px-3 py-1.5 tabular-nums">
                      £{pounds(report.receiptsAndPayments.grandTotals.receipts)}
                    </td>
                  </tr>

                  <tr className="bg-red-50 border-t border-slate-200">
                    <td colSpan={2 + visibleFunds.length + 1} className="px-3 py-1.5 font-semibold text-red-900">
                      {t("reports.paymentsHeader")}
                    </td>
                  </tr>
                  {report.receiptsAndPayments.payments.map((r) => (
                    <tr key={r.categoryId} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-xs text-slate-500">{r.code}</td>
                      <td className="px-3 py-1.5">{r.label}</td>
                      {visibleFunds.map((f) => (
                        <td key={f.fundId} className="text-right px-3 py-1.5 tabular-nums">
                          {r.byFund[f.fundId] ? `£${pounds(r.byFund[f.fundId])}` : "—"}
                        </td>
                      ))}
                      <td className="text-right px-3 py-1.5 tabular-nums font-medium">
                        {r.total ? `£${pounds(r.total)}` : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                    <td className="px-3 py-1.5"></td>
                    <td className="px-3 py-1.5">Total payments</td>
                    {visibleFunds.map((f) => (
                      <td key={f.fundId} className="text-right px-3 py-1.5 tabular-nums">
                        £{pounds(report.receiptsAndPayments.totalsByFund[f.fundId]?.payments ?? 0)}
                      </td>
                    ))}
                    <td className="text-right px-3 py-1.5 tabular-nums">
                      £{pounds(report.receiptsAndPayments.grandTotals.payments)}
                    </td>
                  </tr>

                  <tr className="bg-slate-100 border-t border-slate-300 font-semibold">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2">Net (receipts − payments)</td>
                    {visibleFunds.map((f) => (
                      <td key={f.fundId} className="text-right px-3 py-2 tabular-nums">
                        £{pounds(report.receiptsAndPayments.totalsByFund[f.fundId]?.net ?? 0)}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums">
                      £{pounds(report.receiptsAndPayments.grandTotals.net)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Statement of Assets & Liabilities */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">Statement of Assets &amp; Liabilities</h2>

            {/* Bank balance */}
            <div className="bg-white border border-slate-200 rounded p-4 mb-3">
              <label className="block text-sm font-medium mb-1">{t("reports.bankBalance")}</label>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">£</span>
                <input
                  type="text"
                  value={bankBalanceInput}
                  onChange={(e) => setBankBalanceInput(e.target.value)}
                  disabled={yearLocked}
                  placeholder="e.g. 1234.56"
                  className="border border-slate-300 rounded px-3 py-2 text-sm w-40"
                />
                <button
                  onClick={saveBankBalance}
                  disabled={yearLocked}
                  className="px-3 py-2 bg-green-700 text-white text-sm rounded disabled:opacity-50"
                >
                  {t("reports.saveBankBalance")}
                </button>
              </div>
            </div>

            {/* Add line */}
            {!yearLocked && (
              <form onSubmit={addAssetLiability} className="bg-white border border-slate-200 rounded p-4 mb-3 grid gap-2 sm:grid-cols-5">
                <select
                  value={alForm.kind}
                  onChange={(e) => setAlForm({ ...alForm, kind: e.target.value as SoALRow["kind"] })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                >
                  <optgroup label="Assets">
                    {ASSET_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </optgroup>
                  <optgroup label="Liabilities">
                    {LIABILITY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </optgroup>
                </select>
                <input
                  required
                  type="text"
                  placeholder="Name"
                  value={alForm.name}
                  onChange={(e) => setAlForm({ ...alForm, name: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
                <input
                  required
                  type="text"
                  placeholder="£ Amount"
                  value={alForm.amount}
                  onChange={(e) => setAlForm({ ...alForm, amount: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={alForm.notes}
                  onChange={(e) => setAlForm({ ...alForm, notes: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
                <button type="submit" className="px-3 py-1.5 bg-green-700 text-white text-sm rounded">
                  Add line
                </button>
              </form>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-white border border-slate-200 rounded">
                <div className="bg-slate-50 px-3 py-2 font-semibold">Assets</div>
                <table className="w-full text-sm">
                  <tbody>
                    {report.statementOfAssetsAndLiabilities.assets.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-3 text-slate-500 text-center">No assets recorded.</td></tr>
                    )}
                    {report.statementOfAssetsAndLiabilities.assets.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-xs text-slate-500">{KIND_LABEL[a.kind]}</td>
                        <td className="px-3 py-1.5">{a.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">£{pounds(a.amount)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {!yearLocked && (
                            <button onClick={() => deleteAL(a.id)} className="text-xs text-red-700 hover:underline">
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2">Total assets (excl. bank)</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        £{pounds(report.statementOfAssetsAndLiabilities.totalAssets)}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-white border border-slate-200 rounded">
                <div className="bg-slate-50 px-3 py-2 font-semibold">Liabilities</div>
                <table className="w-full text-sm">
                  <tbody>
                    {report.statementOfAssetsAndLiabilities.liabilities.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-3 text-slate-500 text-center">No liabilities recorded.</td></tr>
                    )}
                    {report.statementOfAssetsAndLiabilities.liabilities.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-xs text-slate-500">{KIND_LABEL[a.kind]}</td>
                        <td className="px-3 py-1.5">{a.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">£{pounds(a.amount)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {!yearLocked && (
                            <button onClick={() => deleteAL(a.id)} className="text-xs text-red-700 hover:underline">
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2">Total liabilities</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        £{pounds(report.statementOfAssetsAndLiabilities.totalLiabilities)}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 bg-slate-100 border border-slate-300 rounded p-4 grid gap-2 sm:grid-cols-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Bank balance at end</div>
                <div className="text-lg font-semibold">
                  £{pounds(report.statementOfAssetsAndLiabilities.bankBalanceAtEnd ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Net assets (incl. bank)</div>
                <div className="text-lg font-semibold">
                  £{pounds(report.statementOfAssetsAndLiabilities.netAssets)}
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Net assets = total assets + bank balance − total liabilities.
              </div>
            </div>
          </section>

          <p className="text-xs text-slate-500">
            Use <strong>Export R&amp;P CSV</strong> above to download the receipts &amp; payments table for
            attaching to your annual return. The Statement of Assets &amp; Liabilities should be
            transcribed onto your regulator&apos;s template.
          </p>
        </>
      )}
    </div>
  );
}
