/**
 * B-02: sessions issued before a password reset are revoked. The jwt callback
 * compares the token's iat with User.passwordChangedAt; the session callback
 * then yields a session with no user.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { authOptions } from "@/lib/auth";
import { prismaMock } from "@/test-utils/prisma-mock";

const jwt = authOptions.callbacks!.jwt! as (args: any) => Promise<any>;
const sessionCb = authOptions.callbacks!.session! as (args: any) => Promise<any>;

const nowSec = () => Math.floor(Date.now() / 1000);
const adminToken = (iat: number) => ({ sub: "u1", iat, role: "PLATFORM_ADMIN", actingAs: null });

describe("session revocation after password change [B-02]", () => {
  it("revokes a token issued before passwordChangedAt", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordChangedAt: new Date() } as never);
    const out = await jwt({ token: adminToken(nowSec() - 3600) });
    expect(out.sub).toBeUndefined();
    expect(out.revoked).toBe(true);
  });

  it("the session callback then returns no user", async () => {
    const out = await sessionCb({ session: { user: { name: "x" }, expires: "2099-01-01" }, token: { revoked: true } });
    expect(out.user).toBeUndefined();
  });

  it("keeps a token issued after passwordChangedAt", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordChangedAt: new Date(Date.now() - 3600_000) } as never);
    const out = await jwt({ token: adminToken(nowSec()) });
    expect(out.sub).toBe("u1");
    expect(out.revoked).toBeUndefined();
  });

  it("keeps a token when the password was never changed", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordChangedAt: null } as never);
    const out = await jwt({ token: adminToken(nowSec() - 3600) });
    expect(out.sub).toBe("u1");
  });
});
