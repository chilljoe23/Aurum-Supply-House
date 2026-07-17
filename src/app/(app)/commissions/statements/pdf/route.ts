import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getCommissionsList } from "@/lib/commissions/queries";
import { CommissionStatement } from "@/components/commissions/commission-statement";
import { buildStatementModel, type StatementStatusFilter } from "@/lib/commissions/statement-model";
import { sanitizeFilenamePart } from "@/lib/documents/branding";
import { getLogoDataUri, renderDocumentToPdf, ChromiumNotFoundError } from "@/lib/documents/pdf";

// True PDF download for the recipient-facing COMMISSION STATEMENT — the same
// real-PDF pipeline, official logo, and shared document branding as the Invoice /
// Quote / Purchase Order routes. No second PDF system is introduced.
//
// Security: middleware blocks unauthenticated requests; we re-check the session
// here (defense in depth). Commissions are read through the RLS-scoped
// v_commissions view with the caller's cookies (getCommissionsList), so a rep can
// only ever produce a statement from commissions they are permitted to see, and
// the statement is built for exactly ONE recipient (the `recipient` param). No
// service-role key is used. StatementModel structurally omits client cost, gross
// profit, margin, and company net profit — those can never appear here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FILTERS: StatementStatusFilter[] = ["active", "earned", "approved", "paid", "all"];

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const recipientKey = url.searchParams.get("recipient") ?? "";
  const statusParam = url.searchParams.get("status") ?? "active";
  const status: StatementStatusFilter = STATUS_FILTERS.includes(statusParam as StatementStatusFilter)
    ? (statusParam as StatementStatusFilter)
    : "active";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!recipientKey) return new Response("Missing recipient", { status: 400 });

  // Same RLS-scoped read + same shared builder the on-screen preview uses, so the
  // PDF cannot drift from what the Owner saw before downloading.
  const commissions = await getCommissionsList();
  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const model = buildStatementModel(commissions, { recipientKey, statusFilter: status, from, to, generatedOn });
  if (!model) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentToPdf(
      createElement(CommissionStatement, { model, logoSrc: getLogoDataUri() }),
      `Commission Statement — ${model.recipient.name} — Aurum Supply House`,
    );
    const namePart = sanitizeFilenamePart(model.recipient.name) || "Recipient";
    const filename = `Aurum-Commission-Statement-${namePart}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ChromiumNotFoundError) {
      return new Response("PDF renderer unavailable", { status: 503 });
    }
    throw e;
  }
}
