// Helpers for calling Next.js route handlers directly in unit tests.
import { NextRequest } from "next/server";

type RequestInit = ConstructorParameters<typeof NextRequest>[1];

/** A request to `path` (e.g. "/api/bookings?x=1") on http://localhost. */
export function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), init);
}

/** A JSON request with the given method and body. */
export function jsonRequest(method: string, path: string, body?: unknown): NextRequest {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The second argument Next passes to a dynamic route handler. */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** Reads a handler's JSON response as { status, body }. */
export async function readJson<T = any>(res: Response): Promise<{ status: number; body: T }> {
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
