import { db } from "@/lib/db";
import { magicTokens } from "@/lib/db/schema";
import { eq, gt, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { Resend } from "resend";

const FIFTEEN_MINUTES_MS = 1000 * 60 * 15;

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY environment variable is not set");
  return new Resend(key);
}

export function generateMagicToken(): string {
  return uuidv4();
}

export async function storeMagicToken(
  email: string,
  token: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + FIFTEEN_MINUTES_MS);

  // Delete any existing tokens for this email before inserting a fresh one
  await db.delete(magicTokens).where(eq(magicTokens.email, email));

  await db.insert(magicTokens).values({ email, token, expiresAt });
}

export async function verifyMagicToken(
  token: string
): Promise<{ email: string } | null> {
  const now = new Date();

  const [record] = await db
    .select({ email: magicTokens.email })
    .from(magicTokens)
    .where(
      and(eq(magicTokens.token, token), gt(magicTokens.expiresAt, now))
    )
    .limit(1);

  if (!record) return null;

  // Consume the token immediately so it can't be reused
  await db.delete(magicTokens).where(eq(magicTokens.token, token));

  return record;
}

export async function sendMagicLink(
  email: string,
  token: string
): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const link = `${appUrl}/api/auth/verify?token=${token}`;

  await getResend().emails.send({
    from: process.env.RESEND_FROM ?? "noreply@example.com",
    to: email,
    subject: "Your Sprig login link",
    text: `Click the link below to sign in to Sprig. This link expires in 15 minutes.\n\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: monospace; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #1a1a18;">
        <p style="font-size: 14px; line-height: 1.6; margin: 0 0 24px;">Click the link below to sign in to Sprig. This link expires in 15 minutes.</p>
        <a href="${link}" style="display: inline-block; font-size: 13px; color: #1a1a18; text-decoration: underline;">${link}</a>
        <p style="font-size: 12px; color: #888880; margin: 32px 0 0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}
