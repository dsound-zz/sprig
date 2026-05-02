import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq, gt, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "sprig_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30, // 30 days in seconds
};

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

export async function createSession(userId: string): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

  await db.insert(sessions).values({
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function getSession(
  token: string
): Promise<{ userId: string } | null> {
  const now = new Date();

  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  return session ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function getSessionFromRequest(
  request: NextRequest
): Promise<{ userId: string } | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSession(token);
}
