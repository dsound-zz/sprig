import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FAFAF8] dark:bg-[#111110]">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
