import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// The generated database.types.ts is regenerated from the live schema after
// migrations are applied. M5 adds new views (v_commissions, v_ar_aging,
// v_ar_summary, v_commission_summary) and RPCs (create_commission, …) that are
// not yet in the committed types. Until `npm run gen:types` is re-run against the
// migrated database, these reads/writes go through a loosely-typed client so the
// app compiles. Runtime behavior is identical; only compile-time relation typing
// is relaxed for the new objects.
export async function createUntypedClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}
