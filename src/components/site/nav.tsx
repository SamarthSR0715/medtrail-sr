import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, LogIn, LogOut, Menu, Moon, Sun, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems } from "@/lib/site-data";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/contexts/auth-context";
import { SearchCommand } from "./search-command";

export function SiteNav() {
  const { theme, toggle } = useTheme();
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const displayName = user?.user_metadata?.["full_name"] || user?.email?.split("@")[0] || "User";

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate({ to: "/" });
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-3xl px-3 py-2.5 transition-all duration-500 sm:px-4",
          scrolled ? "glass-strong" : "glass",
        )}
      >
        <Link to="/" className="flex shrink-0 items-center gap-2.5 pl-1" onClick={() => setOpen(false)}>
          <span className="bg-gradient-brand flex size-9 items-center justify-center rounded-2xl text-brand-foreground shadow-lg">
            <Activity className="size-4.5" aria-hidden="true" />
          </span>
          <span className="font-display text-base font-semibold tracking-tight">MedTrail</span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "bg-secondary/80 text-foreground" }}
                inactiveProps={{ className: "text-muted-foreground" }}
                className="rounded-full px-3.5 py-2 text-sm font-medium transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <SearchCommand />

          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="glass flex size-10 items-center justify-center rounded-full text-foreground transition-transform hover:scale-105"
          >
            {theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>

          {!loading && (
            user ? (
              <div className="hidden sm:flex items-center gap-2 pl-1">
                <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium">
                  <User className="size-3.5 text-primary" />
                  <span className="max-w-[120px] truncate">{displayName}</span>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Log out"
                  aria-label="Log out"
                  className="glass flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-destructive transition-colors"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2 pl-1">
                <Link
                  to="/login"
                  className="rounded-full px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="bg-gradient-brand rounded-full px-4 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
                >
                  Sign Up
                </Link>
              </div>
            )
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="glass flex size-10 items-center justify-center rounded-full lg:hidden"
          >
            {open ? <X className="size-4.5" /> : <Menu className="size-4.5" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div className="glass-strong mx-auto mt-2 max-w-6xl overflow-hidden rounded-3xl p-3 lg:hidden space-y-2">
          <ul className="flex flex-col">
            {navItems.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  activeProps={{ className: "bg-secondary/70 text-foreground" }}
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-border/40 pt-2.5 mt-1">
            {user ? (
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <User className="size-4 text-primary" />
                  <span className="truncate">{displayName}</span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:underline"
                >
                  <LogOut className="size-3.5" />
                  Log out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-1">
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-2xl border border-border/60 py-2 text-center text-xs font-medium text-foreground hover:bg-secondary/50"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setOpen(false)}
                  className="bg-gradient-brand flex-1 rounded-2xl py-2 text-center text-xs font-semibold text-brand-foreground shadow-sm"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}