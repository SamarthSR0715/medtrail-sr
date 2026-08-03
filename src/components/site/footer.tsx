import { Link } from "@tanstack/react-router";
import { Activity, Instagram, Linkedin } from "lucide-react";
import { navItems, socials } from "@/lib/site-data";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/60 px-4 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="bg-gradient-brand flex size-9 items-center justify-center rounded-2xl text-brand-foreground">
              <Activity className="size-4.5" aria-hidden="true" />
            </span>
            <span className="font-display text-base font-semibold">MedTrail</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Medicine, mountains and momentum — one calm workspace by Samarth Rautrao.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-2.5 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex gap-3">
          <a
            href={socials.instagram}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Instagram"
            className="glass flex size-11 items-center justify-center rounded-2xl transition-transform hover:scale-105"
          >
            <Instagram className="size-5" />
          </a>
          <a
            href={socials.linkedin}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="LinkedIn"
            className="glass flex size-11 items-center justify-center rounded-2xl transition-transform hover:scale-105"
          >
            <Linkedin className="size-5" />
          </a>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-muted-foreground">
        © {new Date().getFullYear()} MedTrail · Built by Samarth Rautrao
      </p>
    </footer>
  );
}