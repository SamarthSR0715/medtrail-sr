import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems } from "@/lib/site-data";
import { useTheme } from "@/lib/theme";
import { SearchCommand } from "./search-command";

export function SiteNav() {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
        <div className="glass-strong mx-auto mt-2 max-w-6xl overflow-hidden rounded-3xl p-2 lg:hidden">
          <ul className="flex flex-col">
            {navItems.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  activeProps={{ className: "bg-secondary/70" }}
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-sm font-medium"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}