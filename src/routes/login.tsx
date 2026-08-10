import { useState, useId } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check, Eye, EyeOff, LockKeyhole, Mail, Mountain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login | MedTrailSR" },
      {
        name: "description",
        content: "Login to your MedTrailSR account.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const emailId = useId();
  const passwordId = useId();

  // If user is already authenticated, redirect to home page
  if (user && !message) {
    navigate({ to: "/" });
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      setLoading(false);
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      setLoading(false);
      return;
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        let msg = signInError.message;
        if (msg.includes("Invalid login credentials")) {
          msg = "Incorrect email or password. Please check your credentials and try again.";
        } else if (msg.includes("Email not confirmed")) {
          msg = "Please confirm your email address before logging in. Check your inbox for the confirmation link.";
        }
        setError(msg);
        setLoading(false);
        return;
      }

      setMessage("Logged in successfully! Redirecting...");
      setTimeout(() => {
        navigate({ to: "/" });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[80vh] px-4 py-12">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <div className="glass w-full rounded-[2rem] p-7 sm:p-9 shadow-xl border border-white/20 dark:border-white/10">
          <div className="text-center">
            <div className="bg-gradient-brand mx-auto flex size-14 items-center justify-center rounded-2xl text-brand-foreground shadow-lg">
              <Mountain className="size-7" aria-hidden="true" />
            </div>

            <h1 className="mt-6 text-3xl font-semibold">Welcome back</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Login to continue to your MedTrailSR workspace.
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-8 space-y-5">
            <div>
              <label htmlFor={emailId} className="mb-2 block text-sm font-medium">
                Email
              </label>

              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />

                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-3 text-sm outline-none transition focus:border-primary focus:bg-background"
                />
              </div>
            </div>

            <div>
              <label htmlFor={passwordId} className="mb-2 block text-sm font-medium">
                Password
              </label>

              <div className="relative">
                <LockKeyhole
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />

                <input
                  id={passwordId}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-3 pr-11 text-sm outline-none transition focus:border-primary focus:bg-background"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive">
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <div>{error}</div>
              </div>
            ) : null}

            {message ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="size-4.5 shrink-0 mt-0.5" />
                <div>{message}</div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-brand w-full rounded-xl px-5 py-3 text-sm font-semibold text-brand-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </div>

          <div className="mt-6 text-center">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to MedTrailSR
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
