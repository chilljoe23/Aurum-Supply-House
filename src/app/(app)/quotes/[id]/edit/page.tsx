import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBuilderData, getEditableQuote } from "@/lib/quotes/queries";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const metadata: Metadata = { title: "Edit quote" };
export const dynamic = "force-dynamic";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [data, quote] = await Promise.all([getBuilderData(), getEditableQuote(id)]);
  if (!quote) notFound();
  // Only drafts are editable; anything else returns to the read-only detail.
  if (quote.status !== "draft") redirect(`/quotes/${id}`);

  const isAdmin = user.role === "owner" || user.role === "admin";
  return <QuoteBuilder data={data} canOverride={isAdmin} initial={quote} />;
}
