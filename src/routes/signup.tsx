import { useState, useId } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Eye, EyeOff, LockKeyhole, Mail, Mountain, User as UserIcon, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign Up | MedTrailSR" },
      {
        name: "description",
        content: "Create your MedTrailSR account to start tracking your MBBS study, travel, and fitness.",
      },
    ],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fullNameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();

  // If already logged in, redirect home
  if (user && !successMessage) {
    navigate({ to: "/" });
  }

  // Password validation criteria
  const hasMinLength = password.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const isPasswordValid = hasMinLength && hasLetter && hasNumber;
  const doPasswordsMatch = password.length > 0 && password === confirmPassword;

  function validateForm(): boolean {
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return false;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return false;
    }
    if (!hasMinLength) {
      setError("Password must be at least 6 characters long.");
      return false;
    }
    if (!hasLetter || !hasNumber) {
      setError("Password must include at least one letter and one number.");
      return false;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return false;
    }
    return true;
  }

  async function handleSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setError("");
    setSuccessMessage("");

    if (!validateForm()) return;

    setLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpError) {
        let msg = signUpError.message;
        if (msg.includes("User already registered")) {
          msg = "An account with this email address already exists. Please login instead.";
        } else if (msg.includes("Password should be")) {
          msg = "Password does not meet security requirements. Please try a stronger password.";
        }
        setError(msg);
        setLoading(false);
        return;
      }

      // Check if session was created directly or email confirmation is required
      if (data.session) {
        setSuccessMessage("Account created successfully! Redirecting...");
        setTimeout(() => {
          navigate({ to: "/" });
        }, 1500);
      } else if (data.user) {
        setSuccessMessage(
          "Account created! Please check your email inbox to verify your email address before logging in."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred during sign up. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[85vh] px-4 py-8 sm:py-12">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <div className="glass w-full rounded-[2rem] p-6 sm:p-9 shadow-xl border border-white/20 dark:border-white/10">
          <div className="text-center">
            <div className="bg-gradient-brand mx-auto flex size-14 items-center justify-center rounded-2xl text-brand-foreground shadow-lg">
              <Mountain className="size-7" aria-hidden="true" />
            </div>

            <h1 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight">Create an account</h1>

            <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
              Join MedTrailSR to access study planners, travel logs, and workout trackers.
            </p>
          </div>

          <form onSubmit={handleSignUp} className="mt-7 space-y-4">
            {/* Full Name */}
            <div>
              <label htmlFor={fullNameId} className="mb-1.5 block text-sm font-medium">
                Full Name
              </label>

              <div className="relative">
                <UserIcon
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />

                <input
                  id={fullNameId}
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Samarth Rautrao"
                  required
                  autoComplete="name"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-2.5 text-sm outline-none transition focus:border-primary focus:bg-background"
                />
              </div>
            </div>

            {/* Email Address */}
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium">
                Email Address
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
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-2.5 text-sm outline-none transition focus:border-primary focus:bg-background"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium">
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
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-2.5 pr-11 text-sm outline-none transition focus:border-primary focus:bg-background"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              {/* Password strength checklist */}
              {password.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className={hasMinLength ? "text-emerald-500" : "text-muted-foreground/60"}>
                      {hasMinLength ? <Check className="size-3.5 inline" /> : "•"}
                    </span>
                    <span>At least 6 characters</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={hasLetter && hasNumber ? "text-emerald-500" : "text-muted-foreground/60"}>
                      {hasLetter && hasNumber ? <Check className="size-3.5 inline" /> : "•"}
                    </span>
                    <span>Contains letters and numbers</span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor={confirmPasswordId} className="mb-1.5 block text-sm font-medium">
                Confirm Password
              </label>

              <div className="relative">
                <LockKeyhole
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />

                <input
                  id={confirmPasswordId}
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border bg-background/50 px-10 py-2.5 pr-11 text-sm outline-none transition focus:border-primary focus:bg-background"
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              {confirmPassword.length > 0 && (
                <p className={`mt-1 text-xs ${doPasswordsMatch ? "text-emerald-500" : "text-destructive"}`}>
                  {doPasswordsMatch ? "Passwords match" : "Passwords do not match"}
                </p>
              )}
            </div>

            {/* Error banner */}
            {error ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive">
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <div>{error}</div>
              </div>
            ) : null}

            {/* Success banner */}
            {successMessage ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="size-4.5 shrink-0 mt-0.5" />
                <div>{successMessage}</div>
              </div>
            ) : null}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || !isPasswordValid || !doPasswordsMatch}
              className="bg-gradient-brand mt-2 w-full rounded-xl px-5 py-3 text-sm font-semibold text-brand-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to MedTrailSR
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
