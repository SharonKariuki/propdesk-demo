import { useCallback } from "react";

import { useAuth } from "@/hooks/useAuth";
import { hasPermission, type Permission } from "@/lib/permissions";

/** `const can = useCan(); can("payments.record")` — the signed-in user's permissions. */
export function useCan() {
  const { user } = useAuth();
  return useCallback((permission: Permission) => hasPermission(user, permission), [user]);
}
