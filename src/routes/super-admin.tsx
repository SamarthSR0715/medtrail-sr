import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LogIn, LogOut, ShieldAlert, AlertTriangle, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { isSuperAdminEmail } from "@/lib/super-admin-service";
import { SuperAdminControlCenter } from "@/components/admin/super-admin-control-center";
import { Reveal } from "@/components/site/reveal";

export const Route = createFileRoute("/super-admin")({
  head: () => ({
    meta: [
      { title: "MedTrail Control Center | Super Admin" },
      {
        name: "description",
        content: "MedTrail Control Center — Headquarters for managing the Championship.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SuperAdminPage,
});

function SuperAdminPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="glass flex items-center gap-3 rounded-2xl px-6 py-4 text-sm font-medium">
          <div className="size-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <span>Verifying Super Admin Authorization...</span>
        </div>
      </div>
    );
  }

  // Check if current authenticated user is the designated Super Admin
  const isAuthorized = user && isSuperAdminEmail(user.email);

  // If unauthorized: Block access completely and show 403 — Access Denied
  if (!isAuthorized) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4 py-16">
        <div className="mx-auto max-w-lg w-full">
          <Reveal className="p-8 sm:p-10 rounded-3xl bg-slate-950/90 border border-rose-500/40 text-center shadow-2xl space-y-6 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-48 h-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

            <div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shadow-xl shadow-rose-500/20">
              <ShieldAlert className="size-10" />
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold uppercase tracking-wider">
                <AlertTriangle className="size-3.5" />
                HTTP 403 Forbidden
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight">
                403 — Access Denied
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
                This MedTrail Control Center is strictly restricted to the Super Administrator. Access is blocked for unverified credentials.
              </p>
            </div>

            {user ? (
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-left space-y-2 font-mono">
                <div className="text-slate-400">Authenticated Session:</div>
                <div className="font-bold text-rose-300 truncate">{user.email}</div>
                <div className="text-[11px] text-slate-500 font-sans">
                  This email is not authorized for Super Admin clearance.
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-center text-slate-400">
                You are currently not signed in. An authenticated Super Admin session is required.
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              {user ? (
                <button
                  onClick={async () => {
                    await signOut();
                    navigate({ to: "/login" });
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 px-6 py-3 text-xs font-bold transition cursor-pointer"
                >
                  <LogOut className="size-4 text-amber-400" />
                  Sign In with Different Account
                </button>
              ) : (
                <Link
                  to="/login"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 px-6 py-3 text-xs font-black uppercase tracking-wider transition shadow-lg shadow-amber-500/20"
                >
                  <LogIn className="size-4" />
                  Sign In to MedTrail
                </Link>
              )}

              <Link
                to="/championship"
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white px-5 py-3 text-xs font-semibold transition"
              >
                <ArrowLeft className="size-3.5" />
                Return to Championship
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  // Super Admin view
  return (
    <div className="px-4 pb-20 pt-2">
      <div className="mx-auto max-w-6xl">
        <SuperAdminControlCenter />
      </div>
    </div>
  );
}
