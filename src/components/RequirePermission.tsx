import { ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, hasPermission, type Permission, type Role } from "@/lib/permissions";

/**
 * Route guard: renders the page only for a role that holds the permission,
 * otherwise a calm "no access" screen. The API refuses the same requests, so
 * this is about not showing a page that would only fill with errors.
 */
export default function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (hasPermission(user, permission)) return <>{children}</>;
  const role = ROLE_LABELS[(user?.role ?? "viewer") as Role] ?? "your role";
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-500 dark:bg-ink-800">
        <ShieldOff className="h-6 w-6" />
      </div>
      <p className="text-[12px] font-medium text-ink-500">No access</p>
      <h1 className="font-display text-3xl font-semibold text-ink-900">This page isn't available to you.</h1>
      <p className="max-w-md text-sm text-ink-600">
        Signed in as {role}. Ask the owner if you need access — roles and what each can do are listed under Settings.
      </p>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
      </div>
    </div>
  );
}
