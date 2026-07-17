import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBuilderData } from "@/lib/quotes/queries";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const metadata: Metadata = { title: "New quote" };
export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const data = await getBuilderData();
  const isAdmin = user.role === "owner" || user.role === "admin";

  return <QuoteBuilder data={data} canOverride={isAdmin} />;
}
