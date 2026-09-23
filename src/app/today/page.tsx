import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TodayQueue } from "@/components/today-queue";
import { readSession } from "@/lib/auth";
import { getLeadCards } from "@/services/read-models";

export const metadata: Metadata = { title: "Today" };
export default async function TodayPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  const leads = await getLeadCards(user);
  return <TodayQueue user={user} initialLeads={leads} />;
}
