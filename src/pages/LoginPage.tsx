import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import AuthShell from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { isLocalProvider } from "@/data/config";
import { useAuth } from "@/hooks/useAuth";

const DEMO_PASSWORD = "demo1234";

const DEMO_ACCOUNTS = [
  { email: "owner@mawingu.test", role: "Owner / Admin", note: "Everything" },
  { email: "accountant@mawingu.test", role: "Accountant", note: "Records money" },
  { email: "caretaker@mawingu.test", role: "Caretaker", note: "On-site work" },
];

/** Demo mode only: one tap signs in as a synthetic account. */
function DemoAccounts({ onPick, busy }: { onPick: (email: string) => void; busy: boolean }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-content">Try the demo</p>
        <p className="text-xs text-content-muted">
          password <span className="font-mono text-content">{DEMO_PASSWORD}</span>
        </p>
      </div>
      <ul className="mt-3 grid gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(a.email)}
              className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-hover/60 disabled:opacity-60"
            >
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-expected text-[11.5px] font-semibold text-content">
                {a.role.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-content">
                  {a.role} <span className="font-normal text-content-muted">· {a.note}</span>
                </span>
                <span className="block truncate font-mono text-[11.5px] text-content-muted">{a.email}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-content" strokeWidth={1.7} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

interface LocationState {
  from?: { pathname?: string };
}

const inputCls =
  "h-[46px] w-full rounded-[14px] border border-border bg-surface pl-11 pr-11 text-[14px] text-content placeholder:text-content-soft transition-shadow focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/15";

const labelCls = "mb-1.5 block text-xs font-medium text-content-muted";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  if (user) {
    const from = (location.state as LocationState | null)?.from?.pathname ?? "/dashboard";
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      toast.success("Welcome back");
      const from = (location.state as LocationState | null)?.from?.pathname ?? "/dashboard";
      navigate(from, { replace: true });
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      const status = axiosErr.response?.status;
      if (status === 429) {
        toast.error("Account locked. Try again in 30 minutes.");
      } else if (status === 400) {
        toast.error("Invalid email or password.");
      } else {
        toast.error("Login failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Your buildings, tenants and collections, in one place.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className={labelCls}>
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-content-muted" strokeWidth={1.7} />
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              {...register("email")}
              className={inputCls}
              placeholder="you@clinic.com"
            />
          </div>
          {errors.email && <p className="mt-1.5 text-xs text-danger">{errors.email.message}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-content-muted">
              Password
            </label>
            <Link to="/reset-password" className="text-xs font-medium text-content hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-content-muted" strokeWidth={1.7} />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              {...register("password")}
              className={inputCls}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-content-muted hover:bg-hover hover:text-content"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-[17px] w-[17px]" strokeWidth={1.7} /> : <Eye className="h-[17px] w-[17px]" strokeWidth={1.7} />}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1.5 text-xs text-danger">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" size="lg" loading={submitting} className="h-12 w-full">
          Sign in
        </Button>
      </form>
      {isLocalProvider && (
        <DemoAccounts
          busy={submitting}
          onPick={(email) => {
            setValue("email", email);
            setValue("password", DEMO_PASSWORD);
            void onSubmit({ email, password: DEMO_PASSWORD });
          }}
        />
      )}
    </AuthShell>
  );
}
