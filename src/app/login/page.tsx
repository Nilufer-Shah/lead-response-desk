import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ challengeId?: string; token?: string }> }) {
  const query = await searchParams;
  return <LoginForm demoMode={env().DEMO_MODE === "true"} magic={query.challengeId && query.token ? { challengeId: query.challengeId, token: query.token } : undefined} />;
}
