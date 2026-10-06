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

type Category = {
  id: string;
  code: string;
  label: string;
  kind: "RECEIPT" | "PAYMENT";
};

type Fund = {
  id: string;
  name: string;
  kind: "UNRESTRICTED" | "RESTRICTED" | "DESIGNATED";
};

type Txn = {
  id: string;
  date: string;
  description: string;
  amount: number;
  reference: string | null;
  category: { id: string; code: string; label: string; kind: "RECEIPT" | "PAYMENT" };
  fund: { id: string; name: string; kind: string };
};

function poundsToPence(input: string): number | null {
  const cleaned = input.trim().replace(/[£,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const padded = (frac + "00").slice(0, 2);
  return Number(whole) * 100 + Number(padded);
}

function penceToPounds(p: number): string {
  return (p / 100).toFixed(2);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Compute sensible start/end dates for a new financial year based on the
 * tenant's FY end month/day. If existing years exist, the next year starts
 * the day after the latest year's end date. Otherwise we find the current
 * FY window from today's date.
 */
function defaultYearDates(
  fyMonth: number,
  fyDay: number,
  existingYears: Year[],
): { startDate: string; endDate: string } {
  if (existingYears.length > 0) {
    const sorted = [...existingYears].sort((a, b) => (a.endDate > b.endDate ? -1 : 1));
    const latestEnd = new Date(sorted[0].endDate + "T00:00:00");
    const nextStart = new Date(latestEnd);
    nextStart.setDate(nextStart.getDate() + 1);
    const nextEnd = new Date(nextStart);
    nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    nextEnd.setDate(nextEnd.getDate() - 1);
    return {
      startDate: `${nextStart.getFullYear()}-${pad2(nextStart.getMonth() + 1)}-${pad2(nextStart.getDate())}`,
      endDate: `${nextEnd.getFullYear()}-${pad2(nextEnd.getMonth() + 1)}-${pad2(nextEnd.getDate())}`,
    };
  }

  const today = new Date();
  const thisYearEnd = new Date(today.getFullYear(), fyMonth - 1, fyDay);
  const endDate = thisYearEnd >= today
    ? thisYearEnd
    : new Date(today.getFullYear() + 1, fyMonth - 1, fyDay);
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 1);
  startDate.setDate(startDate.getDate() + 1);

  return {
    startDate: `${startDate.getFullYear()}-${pad2(startDate.getMonth() + 1)}-${pad2(startDate.getDate())}`,
    endDate: `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-${pad2(endDate.getDate())}`,
  };
}

export default function CharityLedgerPage() {
  const t = useTranslations("charity");
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState<Year[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [error, setError] = useState("");

  // New year form
  const [showNewYear, setShowNewYear] = useState(false);
  const [yearForm, setYearForm] = useState({ startDate: "", endDate: "" });
  const [fyEnd, setFyEnd] = useState<{ month: number; day: number } | null>(null);

  // New fund form
  const [showNewFund, setShowNewFund] = useState(false);
  const [fundForm, setFundForm] = useState({
    name: "",
    kind: "RESTRICTED" as Fund["kind"],
  });

  // New category form
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [catForm, setCatForm] = useState({
    code: "",
    label: "",
    kind: "RECEIPT" as Category["kind"],
  });

  // New transaction form
  const [txnForm, setTxnForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    categoryId: "",
    fundId: "",
    description: "",
    amount: "",
    reference: "",
  });

  // Filters
  const [filterCategory, setFilterCategory] = useState("");
  const [filterFund, setFilterFund] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/charity/years").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/charity/categories").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/charity/funds").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/charity/settings").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([y, c, f, s]: [Year[], Category[], Fund[], any]) => {
        setYears(y);
        setCategories(c);
        setFunds(f);
        if (y.length > 0) setSelectedYearId(y[0].id);

        const m = s?.yearEndMonth as number | undefined;
        const d = s?.yearEndDay as number | undefined;
        if (m && d) {
          setFyEnd({ month: m, day: d });
          setYearForm(defaultYearDates(m, d, y));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedYearId) {
      setTxns([]);
      return;
    }
    const params = new URLSearchParams({ yearId: selectedYearId });
    if (filterCategory) params.set("categoryId", filterCategory);
    if (filterFund) params.set("fundId", filterFund);
    fetch(`/api/charity/transactions?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTxns(d));
  }, [selectedYearId, filterCategory, filterFund]);

  const selectedYear = useMemo(
    () => years.find((y) => y.id === selectedYearId) ?? null,
    [years, selectedYearId],
  );

  const yearLocked = selectedYear?.status === "LOCKED";

  async function createYear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/charity/years", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(yearForm),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    const created: Year = await res.json();
    const updatedYears = [created, ...years];
    setYears(updatedYears);
    setSelectedYearId(created.id);
    setYearForm(fyEnd ? defaultYearDates(fyEnd.month, fyEnd.day, updatedYears) : { startDate: "", endDate: "" });
    setShowNewYear(false);
  }

  async function createFund(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/charity/funds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fundForm),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    const created: Fund = await res.json();
    setFunds([...funds, created]);
    setFundForm({ name: "", kind: "RESTRICTED" });
    setShowNewFund(false);
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/charity/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(catForm),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    const created: Category = await res.json();
    setCategories([...categories, created]);
    setCatForm({ code: "", label: "", kind: "RECEIPT" });
    setShowNewCategory(false);
  }

  async function addTxn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const pence = poundsToPence(txnForm.amount);
    if (pence === null || pence <= 0) {
      setError("Amount must be a positive number, e.g. 12.50");
      return;
    }
    const res = await fetch("/api/charity/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        financialYearId: selectedYearId,
        date: txnForm.date,
        categoryId: txnForm.categoryId,
        fundId: txnForm.fundId,
        description: txnForm.description,
        amount: pence,
        reference: txnForm.reference.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    const created: Txn = await res.json();
    setTxns([created, ...txns]);
    setTxnForm({
      date: txnForm.date,
      categoryId: "",
      fundId: "",
      description: "",
      amount: "",
      reference: "",
    });
  }

  async function deleteTxn(id: string) {
    if (!confirm(t("ledger.deleteTransaction"))) return;
    const res = await fetch(`/api/charity/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    setTxns(txns.filter((t) => t.id !== id));
  }

  async function setYearLock(locked: boolean) {
    if (!selectedYear) return;
    const res = await fetch(`/api/charity/years/${selectedYear.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: locked ? "LOCKED" : "OPEN" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed (${res.status})`);
      return;
    }
    const updated: Year = await res.json();
    setYears(years.map((y) => (y.id === updated.id ? updated : y)));
  }

  if (loading) return <p>{t("overview.loading")}</p>;

  const receipts = txns.filter((t) => t.category.kind === "RECEIPT");
  const payments = txns.filter((t) => t.category.kind === "PAYMENT");
  const totalReceipts = receipts.reduce((s, t) => s + t.amount, 0);
  const totalPayments = payments.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="max-w-6xl">
      <div className="mb-4 text-sm">
        <Link href="/dashboard/charity" className="text-green-700 hover:underline">
          {t("ledger.backToCharity")}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-4">{t("ledger.title")}</h1>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-4">
          {error}
        </div>
      )}

      {/* Year selector */}
      <div className="bg-white border border-slate-200 rounded p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">{t("ledger.financialYear")}</label>
          <select
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            {years.length === 0 && <option value="">{t("ledger.noYears")}</option>}
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.startDate} → {y.endDate} {y.status === "LOCKED" ? "🔒" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowNewYear(!showNewYear)}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50"
          >
            {t("ledger.newYear")}
          </button>
          {selectedYear && (
            <button
              onClick={() => setYearLock(!yearLocked)}
              className="text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50 ml-auto"
            >
              {yearLocked ? t("ledger.unlockYear") : t("ledger.lockYear")}
            </button>
          )}
        </div>

        {showNewYear && (
          <form onSubmit={createYear} className="mt-3 flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs">{t("ledger.startDate")}</label>
              <input
                type="date"
                required
                value={yearForm.startDate}
                onChange={(e) => setYearForm({ ...yearForm, startDate: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs">{t("ledger.endDate")}</label>
              <input
                type="date"
                required
                value={yearForm.endDate}
                onChange={(e) => setYearForm({ ...yearForm, endDate: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <button type="submit" className="px-3 py-1.5 bg-green-700 text-white text-sm rounded">
              {t("ledger.create")}
            </button>
          </form>
        )}
      </div>

      {!selectedYear && (
        <p className="text-slate-600">{t("ledger.createYearPrompt")}</p>
      )}

      {selectedYear && (
        <>
          {/* Add transaction */}
          <div className="bg-white border border-slate-200 rounded p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{t("ledger.addTransaction")}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewFund(!showNewFund)}
                  className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
                >
                  {t("ledger.newFund")}
                </button>
                <button
                  onClick={() => setShowNewCategory(!showNewCategory)}
                  className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
                >
                  {t("ledger.newCategory")}
                </button>
              </div>
            </div>

            {showNewFund && (
              <form onSubmit={createFund} className="mb-3 p-3 bg-slate-50 rounded flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-xs">{t("ledger.fundName")}</label>
                  <input
                    required
                    value={fundForm.name}
                    onChange={(e) => setFundForm({ ...fundForm, name: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs">{t("ledger.fundKind")}</label>
                  <select
                    value={fundForm.kind}
                    onChange={(e) => setFundForm({ ...fundForm, kind: e.target.value as Fund["kind"] })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="UNRESTRICTED">{t("ledger.unrestricted")}</option>
                    <option value="RESTRICTED">{t("ledger.restricted")}</option>
                    <option value="DESIGNATED">{t("ledger.designated")}</option>
                  </select>
                </div>
                <button type="submit" className="px-3 py-1.5 bg-green-700 text-white text-sm rounded">
                  {t("ledger.addFund")}
                </button>
              </form>
            )}

            {showNewCategory && (
              <form onSubmit={createCategory} className="mb-3 p-3 bg-slate-50 rounded flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-xs">{t("ledger.code")}</label>
                  <input
                    required
                    value={catForm.code}
                    onChange={(e) => setCatForm({ ...catForm, code: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-24"
                    placeholder="R10"
                  />
                </div>
                <div>
                  <label className="block text-xs">{t("ledger.label")}</label>
                  <input
                    required
                    value={catForm.label}
                    onChange={(e) => setCatForm({ ...catForm, label: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
                  />
                </div>
                <div>
                  <label className="block text-xs">Kind</label>
                  <select
                    value={catForm.kind}
                    onChange={(e) => setCatForm({ ...catForm, kind: e.target.value as Category["kind"] })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="RECEIPT">{t("ledger.receipt")}</option>
                    <option value="PAYMENT">{t("ledger.payment")}</option>
                  </select>
                </div>
                <button type="submit" className="px-3 py-1.5 bg-green-700 text-white text-sm rounded">
                  {t("ledger.addCategory")}
                </button>
              </form>
            )}

            <form onSubmit={addTxn} className="grid gap-2 sm:grid-cols-6">
              <input
                type="date"
                required
                disabled={yearLocked}
                value={txnForm.date}
                onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
              <select
                required
                disabled={yearLocked}
                value={txnForm.categoryId}
                onChange={(e) => setTxnForm({ ...txnForm, categoryId: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm sm:col-span-2"
              >
                <option value="">{t("ledger.categoryPlaceholder")}</option>
                <optgroup label={t("ledger.receiptsGroup")}>
                  {categories.filter((c) => c.kind === "RECEIPT").map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.label}</option>
                  ))}
                </optgroup>
                <optgroup label={t("ledger.paymentsGroup")}>
                  {categories.filter((c) => c.kind === "PAYMENT").map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.label}</option>
                  ))}
                </optgroup>
              </select>
              <select
                required
                disabled={yearLocked}
                value={txnForm.fundId}
                onChange={(e) => setTxnForm({ ...txnForm, fundId: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— fund —</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <input
                type="text"
                required
                disabled={yearLocked}
                placeholder="Description"
                value={txnForm.description}
                onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm sm:col-span-2"
              />
              <input
                type="text"
                required
                disabled={yearLocked}
                placeholder="£ Amount"
                value={txnForm.amount}
                onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                disabled={yearLocked}
                placeholder="Reference (optional)"
                value={txnForm.reference}
                onChange={(e) => setTxnForm({ ...txnForm, reference: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm sm:col-span-2"
              />
              <button
                type="submit"
                disabled={yearLocked}
                className="px-3 py-1.5 bg-green-700 text-white text-sm rounded disabled:opacity-50 sm:col-span-3"
              >
                {yearLocked ? "Year is locked" : "Add transaction"}
              </button>
            </form>
          </div>

          {/* Summary + filters */}
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            <div className="bg-white border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Total receipts</div>
              <div className="text-xl font-semibold text-green-700">£{penceToPounds(totalReceipts)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Total payments</div>
              <div className="text-xl font-semibold text-red-700">£{penceToPounds(totalPayments)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Net for year (so far)</div>
              <div className="text-xl font-semibold">£{penceToPounds(totalReceipts - totalPayments)}</div>
            </div>
          </div>

          <div className="flex gap-2 mb-3 flex-wrap">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.label}</option>
              ))}
            </select>
            <select
              value={filterFund}
              onChange={(e) => setFilterFund(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All funds</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-left px-3 py-2">Fund</th>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-left px-3 py-2">Ref</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No transactions yet.</td></tr>
                )}
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{t.date.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <span className={t.category.kind === "RECEIPT" ? "text-green-700" : "text-red-700"}>
                        {t.category.code}
                      </span>{" "}
                      {t.category.label}
                    </td>
                    <td className="px-3 py-2">{t.fund.name}</td>
                    <td className="px-3 py-2">{t.description}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{t.reference ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={t.category.kind === "RECEIPT" ? "text-green-700" : "text-red-700"}>
                        {t.category.kind === "RECEIPT" ? "+" : "−"}£{penceToPounds(t.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!yearLocked && (
                        <button
                          onClick={() => deleteTxn(t.id)}
                          className="text-xs text-red-700 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
