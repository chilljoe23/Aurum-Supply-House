import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBuilderData, getEditableOrder } from "@/lib/orders/queries";
import { OrderBuilder } from "@/components/orders/order-builder";

export const metadata: Metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const order = await getEditableOrder(id);
  if (!order) notFound();
  // Only drafts are editable — issued invoices are immutable; send back to detail.
  if (order.status !== "draft") redirect(`/orders/${id}`);

  const data = await getBuilderData();
  const isAdmin = user.role === "owner" || user.role === "admin";

  return <OrderBuilder data={data} canOverride={isAdmin} canSeeInternal={isAdmin} initial={order} />;
}
