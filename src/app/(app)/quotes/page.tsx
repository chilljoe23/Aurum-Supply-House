import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { QuotesManager } from "@/components/quotes/quotes-manager";
import { getQuotesList } from "@/lib/quotes/queries";

export const metadata: Metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const quotes = await getQuotesList();

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Build customer quotes with live price resolution, send branded quote documents, and convert accepted quotes into orders."
        actions={
          <Button asChild>
            <Link href="/quotes/new">
              <Plus className="h-4 w-4" /> New quote
            </Link>
          </Button>
        }
      />
      <QuotesManager quotes={quotes} />
    </>
  );
}
