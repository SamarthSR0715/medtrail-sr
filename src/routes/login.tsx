// MedTrail authentication route 
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LockKeyhole, Mail, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();

  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const resetMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    resetMessages();

    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (isSignUp && password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        if (data.session) {
          await navigate({ to: "/mbbs" });
          return;
        }

        setSuccessMessage(
          "Account created successfully. Please check your email to verify your account, then log in."
        );

        setIsSignUp(false);
        setPassword("");
        setConfirmPassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        await navigate({ to: "/mbbs" });
      }
    } catch (error) {
      console.error(error);
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-7rem)] px-4 py-10 sm:py-16">
      <div className="mx-auto flex max-w-md flex-col">
        <Link
          to="/"
          className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to MedTrail
        </Link>

        <div className="glass rounded-[2rem] p-7 shadow-xl sm:p-9">
          <div className="mb-8 text-center">
            <div className="bg-gradient-brand mx-auto flex size-14 items-center justify-center rounded-2xl text-brand-foreground shadow-lg">
              <LockKeyhole className="size-6" />
            </div>

            <h1 className="mt-5 text-3xl font-semibold">
              {isSignUp ? "Create your account" : "Welcome back"}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {isSignUp
                ? "Create your personal MedTrail account."
                : "Log in to access your personal Med Hub."}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                resetMessages();
                setIsSignUp(false);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                !isSignUp
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                resetMessages();
                setIsSignUp(true);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                isSignUp
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium"
              >
                Email
              </label>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  className="w-full rounded-xl border border-input bg-background px-10 py-3 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium"
              >
                Password
              </label>

              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  required
                  className="w-full rounded-xl border border-input bg-background px-10 py-3 pr-11 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium"
                >
                  Confirm Password
                </label>

                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                    className="w-full rounded-xl border border-input bg-background px-10 py-3 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
                {successMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-brand w-full rounded-xl px-5 py-3.5 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Please wait..."
                : isSignUp
                  ? "Create Account"
                  : "Login"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                resetMessages();
                setIsSignUp((value) => !value);
              }}
              className="font-medium text-primary hover:underline"
            >
              {isSignUp ? "Login" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
