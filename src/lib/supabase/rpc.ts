import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type PublicFunctions = Database["public"]["Functions"];
type FunctionName = keyof PublicFunctions;

/**
 * `supabase gen types` emits every PostgreSQL function argument as a required,
 * non-null field — even when the underlying function declares the parameter as
 * nullable or with a `DEFAULT` (e.g. `p_notes text default null`, or a plain
 * `p_effective date` that the function body `coalesce`s). Callers that
 * legitimately pass `null` for those arguments therefore fail `tsc` with
 * "Type 'null' is not assignable to type 'string'".
 *
 * `callRpc` widens each argument to additionally accept `null`/`undefined`,
 * matching what the database actually accepts, while preserving the argument
 * names, the non-null value types, and the RPC's return typing. Runtime
 * behavior is identical: the same payload is forwarded verbatim to
 * `supabase.rpc`. Centralizing the widening here means the generated
 * `database.types.ts` can be regenerated freely without reintroducing the
 * errors, and no `null` is silently coerced to `""`/`0`.
 */
type NullableArgs<Args> = { [K in keyof Args]: Args[K] | null | undefined };

export function callRpc<Fn extends FunctionName>(
  supabase: SupabaseClient<Database>,
  fn: Fn,
  args: NullableArgs<PublicFunctions[Fn]["Args"]>,
) {
  return supabase.rpc(fn, args as PublicFunctions[Fn]["Args"]);
}
