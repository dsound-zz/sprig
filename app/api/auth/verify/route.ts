import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyMagicToken } from "@/lib/auth/magic-link";
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/session";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/?error=invalid_link", APP_URL));
  }

  try {
    const record = await verifyMagicToken(token);

    if (!record) {
      return NextResponse.redirect(new URL("/?error=invalid_link", APP_URL));
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, record.email))
      .limit(1);

    if (!user) {
      return NextResponse.redirect(new URL("/?error=invalid_link", APP_URL));
    }

    const sessionToken = await createSession(user.id);

    const response = NextResponse.redirect(new URL("/canvas", APP_URL));
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);

    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=invalid_link", APP_URL));
  }
}
