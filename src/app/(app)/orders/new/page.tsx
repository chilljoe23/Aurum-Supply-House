import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBuilderData } from "@/lib/orders/queries";
import { OrderBuilder } from "@/components/orders/order-builder";

export const metadata: Metadata = { title: "New order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const data = await getBuilderData();
  const isAdmin = user.role === "owner" || user.role === "admin";

  return <OrderBuilder data={data} canOverride={isAdmin} canSeeInternal={isAdmin} />;
}
