import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  generateMagicToken,
  storeMagicToken,
  sendMagicLink,
} from "@/lib/auth/magic-link";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    typeof (body as Record<string, unknown>).email !== "string"
  ) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const email = ((body as Record<string, unknown>).email as string)
    .trim()
    .toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  try {
    // Upsert user — never reveal whether the email already exists
    const existingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userId: string;

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({ email })
        .returning({ id: users.id });
      userId = newUser.id;
    }

    const token = generateMagicToken();
    await storeMagicToken(email, token);
    await sendMagicLink(email, token);

    // userId is intentionally not used in the response — only for internal flow
    void userId;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to send login link" },
      { status: 500 }
    );
  }
}
