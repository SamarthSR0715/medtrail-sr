import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { ThemeProvider } from "../lib/theme";
import { SiteNav } from "../components/site/nav";
import { SiteFooter } from "../components/site/footer";
import { AuthProvider } from "../contexts/auth-context";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

// Stale chunk recovery: When new production deployments replace Vite chunks,
// clients with cached HTML or open tabs may encounter dynamic import failures.
// Listening to 'vite:preloadError' automatically reloads the page to fetch the latest assets.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", () => {
    const lastReload = sessionStorage.getItem("app_chunk_reload");
    const now = Date.now();
    if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
      sessionStorage.setItem("app_chunk_reload", String(now));
      window.location.reload();
    }
  });
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  const isDynamicImportError =
    typeof error?.message === "string" &&
    (error.message.includes("dynamically imported module") ||
      error.message.includes("Failed to fetch") ||
      error.message.includes("Loading chunk") ||
      error.message.includes("is not a valid JavaScript MIME type") ||
      error.name === "ChunkLoadError");

  useEffect(() => {
    if (isDynamicImportError && typeof window !== "undefined") {
      const lastReload = sessionStorage.getItem("app_chunk_reload");
      const now = Date.now();
      // If we haven't reloaded in the last 15 seconds, auto-reload to fetch fresh production assets
      if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
        sessionStorage.setItem("app_chunk_reload", String(now));
        window.location.reload();
      }
    }
  }, [isDynamicImportError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {isDynamicImportError ? "App Update Available" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isDynamicImportError
            ? "A newer version of MedTrail was recently deployed. Please refresh to load the latest update."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {isDynamicImportError ? (
            <button
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              Refresh Application
            </button>
          ) : (
            <button
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              Try again
            </button>
          )}
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MedTrail — Study, Travel & Train in One Place" },
      {
        name: "description",
        content:
          "A premium personal workspace by Samarth Rautrao: MBBS study hub, Maharashtra travel journal, fitness tracking and portfolio.",
      },
      { name: "author", content: "Samarth Rautrao" },
      { property: "og:title", content: "MedTrail — Study, Travel & Train in One Place" },
      {
        property: "og:description",
        content: "A premium personal workspace by Samarth Rautrao: MBBS study hub, Maharashtra travel journal, fitness tracking and portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MedTrail — Study, Travel & Train in One Place" },
      { name: "twitter:description", content: "A premium personal workspace by Samarth Rautrao: MBBS study hub, Maharashtra travel journal, fitness tracking and portfolio." },
      { property: "og:site_name", content: "MedTrail" },
      { property: "og:locale", content: "en_IN" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
      { rel: "stylesheet", href: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" },
      {
        rel: "stylesheet",
        href: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <div className="hero-aura min-h-screen">
            <SiteNav />
            <main className="pt-24 sm:pt-28">
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <Outlet />
            </main>
            <SiteFooter />
            <Toaster position="top-right" richColors closeButton />
          </div>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
