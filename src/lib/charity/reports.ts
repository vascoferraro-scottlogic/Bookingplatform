import { prisma } from "@/lib/prisma";
import type {
  CharityCategoryKind,
  CharityFundKind,
  CharityAssetLiabilityKind,
} from "@prisma/client";

export type CategoryRow = {
  categoryId: string;
  code: string;
  label: string;
  kind: CharityCategoryKind;
  // Per-fund breakdown keyed by fundId, plus the total across funds.
  byFund: Record<string, number>;
  total: number;
};

export type FundColumn = {
  fundId: string;
  name: string;
  kind: CharityFundKind;
};

export type ReceiptsAndPayments = {
  yearId: string;
  startDate: string;
  endDate: string;
  funds: FundColumn[];
  receipts: CategoryRow[];
  payments: CategoryRow[];
  totalsByFund: Record<string, { receipts: number; payments: number; net: number }>;
  grandTotals: { receipts: number; payments: number; net: number };
};

export type AssetLiabilityRow = {
  id: string;
  kind: CharityAssetLiabilityKind;
  name: string;
  amount: number;
  notes: string | null;
};

export type StatementOfAssetsAndLiabilities = {
  yearId: string;
  bankBalanceAtEnd: number | null;
  // Pre-grouped by liability vs asset for report layout.
  assets: AssetLiabilityRow[];
  liabilities: AssetLiabilityRow[];
  totalAssets: number;
  totalLiabilities: number;
  netAssets: number; // assets + bankBalance − liabilities
};

const LIABILITY_KINDS: CharityAssetLiabilityKind[] = [
  "CREDITOR",
  "OTHER_LIABILITY",
];

/**
 * Build the Receipts & Payments report for a given financial year.
 * Returns categories/funds with their codes preserved so the report can
 * be rendered in either UI form or CSV form against the regulator's
 * template.
 *
 * Trust the caller to have validated that yearId belongs to tenantId.
 */
export async function buildReceiptsAndPayments(
  tenantId: string,
  yearId: string,
): Promise<ReceiptsAndPayments> {
  const [year, funds, categories, txns] = await Promise.all([
    prisma.charityFinancialYear.findFirstOrThrow({
      where: { id: yearId, tenantId },
    }),
    prisma.charityFund.findMany({
      where: { tenantId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.charityCategory.findMany({
      where: { tenantId },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.charityTransaction.findMany({
      where: { tenantId, financialYearId: yearId },
      select: {
        amount: true,
        kind: true,
        categoryId: true,
        fundId: true,
      },
    }),
  ]);

  const fundCols: FundColumn[] = funds.map((f) => ({
    fundId: f.id,
    name: f.name,
    kind: f.kind,
  }));

  // Initialise category rows with zeroed per-fund buckets.
  function makeRow(c: (typeof categories)[number]): CategoryRow {
    const byFund: Record<string, number> = {};
    for (const f of funds) byFund[f.id] = 0;
    return {
      categoryId: c.id,
      code: c.code,
      label: c.label,
      kind: c.kind,
      byFund,
      total: 0,
    };
  }
  const rowByCategory = new Map<string, CategoryRow>();
  for (const c of categories) rowByCategory.set(c.id, makeRow(c));

  const totalsByFund: Record<string, { receipts: number; payments: number; net: number }> = {};
  for (const f of funds) totalsByFund[f.id] = { receipts: 0, payments: 0, net: 0 };

  for (const t of txns) {
    const row = rowByCategory.get(t.categoryId);
    if (!row) continue; // category deleted while txn survived; defensive
    row.byFund[t.fundId] = (row.byFund[t.fundId] ?? 0) + t.amount;
    row.total += t.amount;
    const fundTotal = totalsByFund[t.fundId] ?? { receipts: 0, payments: 0, net: 0 };
    if (t.kind === "RECEIPT") fundTotal.receipts += t.amount;
    else fundTotal.payments += t.amount;
    fundTotal.net = fundTotal.receipts - fundTotal.payments;
    totalsByFund[t.fundId] = fundTotal;
  }

  const receipts: CategoryRow[] = [];
  const payments: CategoryRow[] = [];
  for (const c of categories) {
    const r = rowByCategory.get(c.id)!;
    if (c.kind === "RECEIPT") receipts.push(r);
    else payments.push(r);
  }

  const grandReceipts = receipts.reduce((s, r) => s + r.total, 0);
  const grandPayments = payments.reduce((s, r) => s + r.total, 0);

  return {
    yearId: year.id,
    startDate: year.startDate,
    endDate: year.endDate,
    funds: fundCols,
    receipts,
    payments,
    totalsByFund,
    grandTotals: {
      receipts: grandReceipts,
      payments: grandPayments,
      net: grandReceipts - grandPayments,
    },
  };
}

/** Build the Statement of Assets & Liabilities. */
export async function buildStatementOfAssetsAndLiabilities(
  tenantId: string,
  yearId: string,
): Promise<StatementOfAssetsAndLiabilities> {
  const [year, lines] = await Promise.all([
    prisma.charityFinancialYear.findFirstOrThrow({
      where: { id: yearId, tenantId },
    }),
    prisma.charityAssetLiability.findMany({
      where: { tenantId, financialYearId: yearId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);

  const assets: AssetLiabilityRow[] = [];
  const liabilities: AssetLiabilityRow[] = [];
  for (const l of lines) {
    const row: AssetLiabilityRow = {
      id: l.id,
      kind: l.kind,
      name: l.name,
      amount: l.amount,
      notes: l.notes,
    };
    if (LIABILITY_KINDS.includes(l.kind)) liabilities.push(row);
    else assets.push(row);
  }

  const totalAssetsExclBank = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalAssets = totalAssetsExclBank + (year.bankBalanceAtEnd ?? 0);

  return {
    yearId: year.id,
    bankBalanceAtEnd: year.bankBalanceAtEnd,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netAssets: totalAssets - totalLiabilities,
  };
}

/** Render the R&P report as CSV. Amounts in pounds (decimal). */
export function receiptsAndPaymentsToCSV(rp: ReceiptsAndPayments): string {
  const fundNames = rp.funds.map((f) => f.name);
  const headerRow = ["Code", "Label", "Kind", ...fundNames, "Total"];

  const lines: string[] = [];
  lines.push(headerRow.map(csvCell).join(","));

  function emit(rows: CategoryRow[]) {
    for (const r of rows) {
      const cells = [
        r.code,
        r.label,
        r.kind,
        ...rp.funds.map((f) => poundsCell(r.byFund[f.fundId] ?? 0)),
        poundsCell(r.total),
      ];
      lines.push(cells.map(csvCell).join(","));
    }
  }

  lines.push(csvCell("--- RECEIPTS ---"));
  emit(rp.receipts);
  lines.push(csvCell("--- PAYMENTS ---"));
  emit(rp.payments);

  // Totals row
  const fundTotals = rp.funds.map((f) => {
    const t = rp.totalsByFund[f.fundId] ?? { net: 0 };
    return poundsCell(t.net);
  });
  lines.push(
    [
      csvCell("TOTAL"),
      csvCell("Net (receipts − payments)"),
      csvCell(""),
      ...fundTotals.map(csvCell),
      csvCell(poundsCell(rp.grandTotals.net)),
    ].join(","),
  );

  return lines.join("\n");
}

function poundsCell(pence: number): string {
  // Two-decimal pounds with sign retained.
  const pounds = pence / 100;
  return pounds.toFixed(2);
}

function csvCell(s: string): string {
  if (s === undefined || s === null) return "";
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
