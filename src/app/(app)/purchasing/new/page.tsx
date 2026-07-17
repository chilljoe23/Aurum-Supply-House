import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getPoBuilderData } from "@/lib/purchase-orders/queries";
import { PoBuilder } from "@/components/purchasing/po-builder";
import { RestrictedNotice } from "@/components/purchasing/restricted-notice";

export const metadata: Metadata = { title: "New purchase order" };
export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (user?.role !== "owner" && user?.role !== "admin") return <RestrictedNotice />;
  const data = await getPoBuilderData();
  return <PoBuilder manufacturers={data.manufacturers} />;
}
