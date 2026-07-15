import { google, type Auth } from "googleapis";
type OAuth2Client = Auth.OAuth2Client;
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { env } from "@/core/env";

/**
 * External-service authorization only. One Google account authorizes SchediCare
 * to touch its Calendar and Gmail; this is NOT an application login and creates
 * no user accounts. Scopes are minimal:
 *   calendar.events — read/write events on mapped calendars
 *   gmail.compose   — create/update/send drafts
 *   gmail.readonly  — read replies on known threads only
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function googleConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI);
}

export function getStoredTokens(): Record<string, unknown> | null {
  const row = db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.provider, "google")).get();
  return row ? (row.tokens as Record<string, unknown>) : null;
}

export function storeTokens(tokens: Record<string, unknown>): void {
  const existing = getStoredTokens() ?? {};
  const merged = { ...existing, ...tokens };
  const now = new Date().toISOString();
  db.insert(schema.oauthTokens)
    .values({ provider: "google", tokens: merged, updatedAt: now })
    .onConflictDoUpdate({ target: schema.oauthTokens.provider, set: { tokens: merged, updatedAt: now } })
    .run();
}

export function clearTokens(): void {
  db.delete(schema.oauthTokens).where(eq(schema.oauthTokens.provider, "google")).run();
}

export function newOAuthClient(): OAuth2Client {
  const e = env();
  return new google.auth.OAuth2(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, e.GOOGLE_REDIRECT_URI);
}

/** Authorized client or null when not configured/connected. Persists refreshed tokens. */
export function authorizedClient(): OAuth2Client | null {
  if (!googleConfigured()) return null;
  const tokens = getStoredTokens();
  if (!tokens) return null;
  const client = newOAuthClient();
  client.setCredentials(tokens);
  client.on("tokens", (t) => storeTokens(t as Record<string, unknown>));
  return client;
}

export function authUrl(): string {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });
}

/** OAuth code → tokens; persists (merging any prior refresh_token). */
export async function exchangeCode(code: string): Promise<void> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  storeTokens(tokens as Record<string, unknown>);
}
