"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const linkError = searchParams.get("error");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="text-center">
        <p className="text-[13px] font-mono text-[#1a1a18] dark:text-[#e8e8e4]">
          Check your email
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 w-64">
      {linkError === "invalid_link" && (
        <p className="text-[11px] font-mono text-red-500 text-center">
          That link has expired or is invalid. Try again.
        </p>
      )}

      <input
        type="email"
        autoFocus
        required
        autoComplete="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
        className="
          w-full bg-transparent border-none outline-none
          text-[13px] font-mono text-center
          text-[#1a1a18] dark:text-[#e8e8e4]
          placeholder:text-[#CCCAC4] dark:placeholder:text-[#3A3A38]
          disabled:opacity-50
        "
      />

      {error && (
        <p className="text-[11px] font-mono text-red-500 text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || email.trim().length === 0}
        className="
          text-[12px] font-mono
          text-[#888880] hover:text-[#1a1a18] dark:hover:text-[#e8e8e4]
          transition-colors duration-100
          disabled:opacity-30 disabled:cursor-not-allowed
        "
      >
        {loading ? "sending…" : "continue"}
      </button>
    </form>
  );
}
