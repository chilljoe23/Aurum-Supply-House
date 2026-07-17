import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPoBuilderData, getEditablePurchaseOrder } from "@/lib/purchase-orders/queries";
import { PoBuilder } from "@/components/purchasing/po-builder";
import { RestrictedNotice } from "@/components/purchasing/restricted-notice";

export const metadata: Metadata = { title: "Edit purchase order" };
export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user?.role !== "owner" && user?.role !== "admin") return <RestrictedNotice />;

  const [data, initial] = await Promise.all([getPoBuilderData(), getEditablePurchaseOrder(id)]);
  if (!initial) notFound();
  return <PoBuilder manufacturers={data.manufacturers} initial={initial} />;
}
