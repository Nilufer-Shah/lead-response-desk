import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TodayQueue } from "@/components/today-queue";
import { readSession } from "@/lib/auth";
import { getTodayQueue } from "@/services/product-read-models";

export const metadata: Metadata = { title: "Today" };
export default async function TodayPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role === "agency") redirect("/");
  const data = await getTodayQueue(user);
  return <TodayQueue user={user} initialData={data} />;
}
