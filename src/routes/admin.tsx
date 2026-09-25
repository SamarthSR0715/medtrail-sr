import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, LogIn, ShieldAlert, Sparkles, MapPin } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AdminPanel } from "@/components/trips/admin-panel";
import { PulseStudio } from "@/components/admin/pulse-studio";
import { Reveal } from "@/components/site/reveal";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "MedTrail Admin Portal | Pulse Studio & Trips" },
      {
        name: "description",
        content: "Admin portal for MedTrail Pulse Question Management, student registrations, and trips.",
      },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, loading } = useAuth();
  const [adminTab, setAdminTab] = useState<"pulse" | "trips">("pulse");

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
              Sign in with your MedTrail administrator account to access the Pulse Studio, curate today's
              questions, manage student registrations, and view reports.
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
                to="/championship"
                className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary transition-colors"
              >
                Back to Championship
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-20">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Navigation Tabs between Pulse Studio and Trips */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-2 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdminTab("pulse")}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2 ${
                adminTab === "pulse"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Pulse Studio
            </button>
            <button
              onClick={() => setAdminTab("trips")}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2 ${
                adminTab === "trips"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Trips & Registrations
            </button>
          </div>

          <div className="flex items-center gap-2 pr-2 text-xs text-slate-400">
            <Link
              to="/championship"
              className="hover:text-amber-400 transition font-semibold"
            >
              View Championship →
            </Link>
          </div>
        </div>

        {/* Tab Content */}
        {adminTab === "pulse" ? <PulseStudio /> : <AdminPanel />}
      </div>
    </div>
  );
}
