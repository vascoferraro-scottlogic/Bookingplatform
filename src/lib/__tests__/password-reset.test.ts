/**
 * POST /api/auth/forgot-password and POST /api/auth/reset-password (B-01, B-02).
 *
 * PasswordResetToken rows live in a small in-memory store behind the Prisma
 * mock, so single-use and invalidation behave as they would against the DB
 * (a delete of a row that is already gone throws, as Prisma's P2025 does).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("@/lib/outbound", () => {
  const sendOutbound = jest.fn(async (_args: unknown) => ({ id: "out-1", status: "QUEUED" }));
  return {
    sendOutbound,
    sendEmail: jest.fn(async (args: any) => sendOutbound({ ...args, channel: "EMAIL" } as never)),
    sendSms: jest.fn(),
    sendSocial: jest.fn(),
    renderTemplate: jest.fn(),
  };
});

import { prismaMock } from "@/test-utils/prisma-mock";
import { jsonRequest, readJson } from "@/test-utils/http";
import { hoursFromNow } from "@/test-utils/dates";
import { POST as forgotPOST } from "@/app/api/auth/forgot-password/route";
import { POST as resetPOST } from "@/app/api/auth/reset-password/route";

const outbound = jest.requireMock("@/lib/outbound") as { sendOutbound: jest.Mock; sendEmail: jest.Mock };

const USER = { id: "user-1", email: "member@example.test", name: "Member", role: "USER", tenantId: "tenant-1", suspended: false };

const forgot = (email: string) => forgotPOST(jsonRequest("POST", "/api/auth/forgot-password", { email }));
// Send the new password under both plausible field names so a fix may rename it.
const reset = (token: string, password: string) =>
  resetPOST(jsonRequest("POST", "/api/auth/reset-password", { token, newPassword: password, password }));

// ─── In-memory PasswordResetToken store ──────────────────────

type TokenRow = { id: string; token: string; userId: string; expiresAt: Date; createdAt: Date };
let tokens: TokenRow[];
let nextId: number;

function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const t = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ("gt" in v) return t(row[k]) > t(v.gt);
      if ("gte" in v) return t(row[k]) >= t(v.gte);
      if ("lt" in v) return t(row[k]) < t(v.lt);
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("equals" in v) return row[k] === v.equals;
      return true;
    }
    return row[k] === v;
  });
}

function seedToken(row: Partial<TokenRow> & { token: string }) {
  tokens.push({ id: `tok-${nextId++}`, userId: USER.id, expiresAt: hoursFromNow(1), createdAt: new Date(), ...row });
}

beforeEach(() => {
  tokens = [];
  nextId = 1;
  const t = prismaMock.passwordResetToken;
  const findOne = async ({ where }: any) => tokens.find((r) => matches(r, where)) ?? null;
  t.findUnique.mockImplementation(findOne as never);
  t.findFirst.mockImplementation(findOne as never);
  t.findMany.mockImplementation((async ({ where }: any = {}) => tokens.filter((r) => matches(r, where))) as never);
  t.create.mockImplementation((async ({ data }: any) => {
    const row = { id: `tok-${nextId++}`, createdAt: new Date(), ...data };
    tokens.push(row);
    return row;
  }) as never);
  t.delete.mockImplementation((async ({ where }: any) => {
    const i = tokens.findIndex((r) => matches(r, where));
    if (i < 0) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
    return tokens.splice(i, 1)[0];
  }) as never);
  t.deleteMany.mockImplementation((async ({ where }: any = {}) => {
    const before = tokens.length;
    tokens = tokens.filter((r) => !matches(r, where));
    return { count: before - tokens.length };
  }) as never);

  const findUser = async ({ where }: any) =>
    where?.id === USER.id || where?.email === USER.email ? USER : null;
  prismaMock.user.findUnique.mockImplementation(findUser as never);
  prismaMock.user.findFirst.mockImplementation(findUser as never);
  prismaMock.user.update.mockResolvedValue(USER as never);
});

describe("POST /api/auth/forgot-password", () => {
  test("[B-01] FR-AUTH-003 – the response never contains the reset token", async () => {
    const { status, body } = await readJson(await forgot(USER.email));

    expect(status).toBe(200);
    expect(tokens).toHaveLength(1); // a token was issued …
    expect(body).not.toHaveProperty("token"); // … but not handed back
    const text = JSON.stringify(body);
    for (const row of tokens) expect(text).not.toContain(row.token);
    expect(text).not.toMatch(/[a-f0-9]{32,}/i);
  });

  test("[B-01] NFR-05 – a known and an unknown email get an identical status and body", async () => {
    const known = await readJson(await forgot(USER.email));
    const unknown = await readJson(await forgot("nobody@example.test"));

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  test("[B-01] FR-AUTH-003 – a known email queues a reset email via @/lib/outbound", async () => {
    await forgot(USER.email);

    const sent = outbound.sendOutbound.mock.calls.map(([a]: any) => a);
    expect(sent).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: "EMAIL", to: USER.email })]),
    );
  });

  test("[B-01] NFR-05 – an unknown email queues no email", async () => {
    await forgot("nobody@example.test");

    expect(outbound.sendOutbound).not.toHaveBeenCalled();
    expect(outbound.sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  test("[B-02] FR-AUTH-003 – a token used twice (concurrently) resets the password once; the second use gets 400", async () => {
    seedToken({ token: "tok-abc" });

    const results = await Promise.all([reset("tok-abc", "NewPass123"), reset("tok-abc", "Other4567")].map((p) =>
      p.then((r) => r.status, () => "threw"),
    ));

    // The password must change exactly once …
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    // … and the losing request is a clean 400, not a crash.
    expect(results.sort()).toEqual([200, 400]);
  });

  test("[B-02] FR-AUTH-003 – a token used a second time after a successful reset gets 400", async () => {
    seedToken({ token: "tok-abc" });

    const first = await reset("tok-abc", "NewPass123");
    const second = await reset("tok-abc", "Other4567");

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });

  test("[B-02] FR-AUTH-003 – issuing a new token invalidates the user's older token", async () => {
    seedToken({ token: "old-token" });

    await forgot(USER.email); // issues a fresh token
    const res = await reset("old-token", "NewPass123");

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("[B-02] FR-AUTH-002 – a weak new password (under 8 characters) is rejected with 400", async () => {
    seedToken({ token: "tok-abc" });

    const res = await reset("tok-abc", "short");

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
