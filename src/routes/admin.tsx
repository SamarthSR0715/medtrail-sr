import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, LogIn, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AdminPanel } from "@/components/trips/admin-panel";
import { Reveal } from "@/components/site/reveal";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "MedTrail Trips Admin | Registrations & Payments" },
      {
        name: "description",
        content: "Admin portal for MedTrail Trips registrations, seat allotment, and payment tracking.",
      },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="glass flex items-center gap-3 rounded-2xl px-6 py-4 text-sm font-medium">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Verifying administrator credentials...</span>
        </div>
      </div>
    );
  }

  // If user is not logged in, prompt for admin authentication
  if (!user) {
    return (
      <div className="px-4 py-16">
        <div className="mx-auto max-w-md">
          <Reveal className="glass rounded-[2rem] border border-border/80 p-8 text-center shadow-xl">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Lock className="size-7" />
            </span>

            <h1 className="mt-5 font-display text-2xl font-bold">Admin Portal</h1>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Sign in with your MedTrail administrator account to view student registrations, update
              payments, and download CSV reports.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <Link
                to="/login"
                className="bg-gradient-brand inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-[1.02]"
              >
                <LogIn className="size-4" />
                Sign in to Admin Dashboard
              </Link>
              <Link
                to="/travel"
                className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary transition-colors"
              >
                Back to MedTrail Trips
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-20">
      <div className="mx-auto max-w-6xl">
        <AdminPanel />
      </div>
    </div>
  );
}
