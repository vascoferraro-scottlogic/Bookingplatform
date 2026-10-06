import { NextRequest } from "next/server";
import { POST as acceptHandler } from "../route";

/**
 * POST /api/invitations/[token]/accept — thin wrapper that forwards to the
 * accept handler in the parent route. Keeps the verb-in-URL nicety.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return acceptHandler(req, ctx);
}
