jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import * as reports from "@/lib/charity/reports";
import { receiptsAndPaymentsToCSV, type ReceiptsAndPayments, type StatementOfAssetsAndLiabilities } from "@/lib/charity/reports";
import { invoiceToCSV } from "@/lib/billing";

/**
 * Minimal RFC 4180 parser. Outside quotes, CRLF, LF or a bare CR ends a row
 * (spreadsheet apps treat a bare CR as a row break), so an unquoted CR/LF in a
 * cell shows up as a broken row.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function rpWithLabels(labels: string[], fundName = "General Fund"): ReceiptsAndPayments {
  return {
    yearId: "y1",
    startDate: "2025-04-01",
    endDate: "2026-03-31",
    funds: [{ fundId: "f1", name: fundName, kind: "UNRESTRICTED" as never }],
    receipts: labels.map((label, i) => ({
      categoryId: `c${i}`,
      code: `R${i}`,
      label,
      kind: "RECEIPT" as never,
      byFund: { f1: 1000 },
      total: 1000,
    })),
    payments: [],
    totalsByFund: { f1: { receipts: 1000 * labels.length, payments: 0, net: 1000 * labels.length } },
    grandTotals: { receipts: 1000 * labels.length, payments: 0, net: 1000 * labels.length },
  };
}

/** The parsed row whose code cell is `code`. */
const rowByCode = (rows: string[][], code: string) => rows.find((r) => r[0] === code);

describe("receiptsAndPaymentsToCSV (src/lib/charity/reports.ts)", () => {
  test.each(["=HYPERLINK(\"http://x.test\",\"click\")", "+SUM(A1:A9)", "-SUM(A1:A9)", "@SUM(A1:A9)"])(
    "[B-84] FR-CHA-004 – a text cell starting with a formula character (%s) is prefixed with '",
    (label) => {
      const rows = parseCsv(receiptsAndPaymentsToCSV(rpWithLabels([label])));

      expect(rowByCode(rows, "R0")?.[1]).toBe(`'${label}`);
    },
  );

  test("[B-84] FR-CHA-004 – a fund name (header cell) starting with = is prefixed with '", () => {
    const rows = parseCsv(receiptsAndPaymentsToCSV(rpWithLabels(["Donations"], "=cmd|' /C calc'!A0")));

    expect(rows[0]).toContain("'=cmd|' /C calc'!A0");
  });

  test("[B-84] FR-CHA-004 – quotes, commas and CR/LF inside a cell round-trip intact", () => {
    const labels = ['Say "hi", please', "Line one\nLine two", "Carriage\rreturn", "Windows\r\nbreak"];
    const rows = parseCsv(receiptsAndPaymentsToCSV(rpWithLabels(labels)));

    labels.forEach((label, i) => expect(rowByCode(rows, `R${i}`)?.[1]).toBe(label));
  });

  test("[B-84] FR-CHA-004 – ordinary text and amounts are left untouched", () => {
    const rows = parseCsv(receiptsAndPaymentsToCSV(rpWithLabels(["Donations"])));

    expect(rowByCode(rows, "R0")).toEqual(["R0", "Donations", "RECEIPT", "10.00", "10.00"]);
  });
});

describe("invoiceToCSV (src/lib/billing.ts)", () => {
  const invoice = {
    invoiceRef: "INV-T1-202610",
    periodStart: new Date("2026-10-01T00:00:00Z"),
    periodEnd: new Date("2026-10-31T00:00:00Z"),
    amount: 1500,
  };
  const line = (description: string) => ({
    description,
    quantity: 1,
    unitPricePence: 1500,
    totalPricePence: 1500,
    category: "SUBSCRIPTION",
  });

  test("[B-84] FR-CHA-004 – quotes in a line-item description are escaped", () => {
    const description = 'Seat licence "Pro", annual';
    const rows = parseCsv(invoiceToCSV(invoice, [line(description)]));
    const item = rows.find((r) => r[4] === "SUBSCRIPTION");

    expect(item?.[0]).toBe(description);
    expect(item).toHaveLength(5);
  });

  test("[B-84] FR-CHA-004 – a line-item description starting with = is prefixed with '", () => {
    const rows = parseCsv(invoiceToCSV(invoice, [line("=1+1")]));
    const item = rows.find((r) => r[4] === "SUBSCRIPTION");

    expect(item?.[0]).toBe("'=1+1");
  });
});

describe("Statement of Assets & Liabilities CSV export", () => {
  const soal: StatementOfAssetsAndLiabilities = {
    yearId: "y1",
    bankBalanceAtEnd: 250000,
    assets: [{ id: "a1", kind: "DEBTOR" as never, name: "Gift Aid due", amount: 12000, notes: null }],
    liabilities: [{ id: "l1", kind: "CREDITOR" as never, name: "=Unpaid invoice", amount: 3000, notes: null }],
    totalAssets: 12000,
    totalLiabilities: 3000,
    netAssets: 259000,
  };

  function soalExporter(): ((s: StatementOfAssetsAndLiabilities) => string) | undefined {
    const mod = reports as Record<string, unknown>;
    const name = Object.keys(mod).find(
      (k) => /(statementOfAssetsAndLiabilities|soal|assetsAndLiabilities).*csv/i.test(k) && typeof mod[k] === "function",
    );
    return name ? (mod[name] as (s: StatementOfAssetsAndLiabilities) => string) : undefined;
  }

  test("[B-84] FR-CHA-004 – reports.ts exports a Statement of Assets & Liabilities CSV renderer", () => {
    expect(soalExporter()).toEqual(expect.any(Function));
  });

  test("[B-84] FR-CHA-004 – the S of A&L CSV lists assets, liabilities and net assets, with risky cells neutralised", () => {
    const toCsv = soalExporter();
    expect(toCsv).toEqual(expect.any(Function));

    const csv = toCsv!(soal);
    const cells = parseCsv(csv).flat();

    expect(cells).toContain("Gift Aid due");
    expect(cells).toContain("'=Unpaid invoice");
    expect(cells).toContain("2590.00");
  });
});
