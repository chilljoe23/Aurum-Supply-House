"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductFormDialog } from "@/components/catalog/product-form-dialog";
import { setProductStatus } from "@/app/(app)/catalog/actions";
import type { CatalogProduct, Manufacturer } from "@/lib/catalog/queries";

export function ProductDetailActions({
  product,
  manufacturers,
  canSeeCost,
}: {
  product: CatalogProduct;
  manufacturers: Manufacturer[];
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function toggle() {
    setBusy(true);
    await setProductStatus(product.id, product.status !== "active");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={toggle} disabled={busy}>
        <Power className="h-4 w-4" />
        {product.status === "active" ? "Deactivate" : "Activate"}
      </Button>
      <Button size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit product
      </Button>
      <ProductFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        manufacturers={manufacturers}
        mode="edit"
        product={product}
        canSeeCost={canSeeCost}
      />
    </div>
  );
}
