import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/navigation";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

/**
 * Loads the authenticated user's profile (id, email, role, name).
 * Returns null when there is no session or no profile row yet.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
}
