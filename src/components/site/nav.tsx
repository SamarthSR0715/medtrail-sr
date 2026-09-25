import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  ChevronDown,
  Crown,
  GraduationCap,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Shield,
  Smartphone,
  Sun,
  Trophy,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { navItems } from "@/lib/site-data";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/contexts/auth-context";
import { SearchCommand } from "./search-command";
import { isSuperAdminEmail } from "@/lib/super-admin-service";
import { requestAndRegisterNotificationPermission } from "@/lib/fcm-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteNav() {
  const { theme, toggle } = useTheme();
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, [user]);

  const displayName = user?.user_metadata?.["full_name"] || user?.email?.split("@")[0] || "User";
  const isSuperAdmin = Boolean(user && isSuperAdminEmail(user.email));

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
                {/* 1. Quick prominent Super Admin badge button if authorized */}
                {isSuperAdmin && (
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 font-bold text-xs shadow-md shadow-amber-500/15 transition-all hover:scale-105"
                  >
                    <Shield className="size-3.5 text-amber-400" />
                    <span>Admin Panel</span>
                  </Link>
                )}

                {/* 2. Interactive Profile Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium hover:border-border transition-colors cursor-pointer"
                    >
                      {isSuperAdmin ? (
                        <Crown className="size-3.5 text-amber-400" />
                      ) : (
                        <User className="size-3.5 text-primary" />
                      )}
                      <span className="max-w-[120px] truncate">{displayName}</span>
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent
                    align="end"
                    className="w-60 glass-strong border border-border/80 p-2 space-y-1 rounded-2xl shadow-2xl z-50 backdrop-blur-xl"
                  >
                    <DropdownMenuLabel className="px-2.5 py-2 font-normal">
                      <div className="text-xs font-bold text-foreground">{displayName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{user.email}</div>
                      {isSuperAdmin && (
                        <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
                          <Crown className="size-2.5" /> Super Admin
                        </div>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-border/60" />

                    {/* Admin Panel Link inside Profile Dropdown for Super Admin */}
                    {isSuperAdmin && (
                      <DropdownMenuItem asChild>
                        <Link
                          to="/admin"
                          className="flex items-center justify-between rounded-xl px-2.5 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20 transition cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <Shield className="size-4 text-amber-400" />
                            Admin Panel
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-500/30">
                            CONTROL
                          </span>
                        </Link>
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem asChild>
                      <Link
                        to="/championship"
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-foreground hover:bg-secondary transition cursor-pointer"
                      >
                        <Trophy className="size-4 text-amber-400" />
                        MedTrail Championship
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <Link
                        to="/mbbs"
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-foreground hover:bg-secondary transition cursor-pointer"
                      >
                        <GraduationCap className="size-4 text-primary" />
                        MBBS Study Hub
                      </Link>
                    </DropdownMenuItem>

                    {/* Push Notifications Toggle */}
                    <DropdownMenuItem
                      onClick={async () => {
                        const res = await requestAndRegisterNotificationPermission(user);
                        if (res.success) {
                          setNotifPermission("granted");
                          toast.success("📱 Push notifications enabled! This device is registered for Pulse & Badge alerts.");
                        } else {
                          toast.error(res.error || "Please allow notifications in browser/phone settings.");
                        }
                      }}
                      className="flex items-center justify-between rounded-xl px-2.5 py-2 text-xs text-foreground hover:bg-secondary transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Bell className="size-4 text-amber-400" />
                        <span>Push Notifications</span>
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                        notifPermission === "granted"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}>
                        {notifPermission === "granted" ? "ACTIVE" : "ENABLE"}
                      </span>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="bg-border/60" />

                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-destructive hover:bg-destructive/10 transition cursor-pointer"
                    >
                      <LogOut className="size-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

      {/* Mobile Drawer / Sidebar */}
      {open ? (
        <div className="glass-strong mx-auto mt-2 max-w-6xl overflow-hidden rounded-3xl p-3 lg:hidden space-y-2">
          {/* Prominent Super Admin button in Mobile Sidebar */}
          {isSuperAdmin && (
            <div className="p-1">
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-2xl bg-amber-500/15 border border-amber-500/40 p-3 text-amber-300 font-bold text-sm shadow-md hover:bg-amber-500/25 transition"
              >
                <span className="flex items-center gap-2.5">
                  <Shield className="size-4 text-amber-400" />
                  <span>Admin Panel</span>
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300">
                  Control Center
                </span>
              </Link>
            </div>
          )}

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
              <div className="space-y-2 px-2">
                {/* Mobile Phone Push Notification Registration */}
                <button
                  type="button"
                  onClick={async () => {
                    const res = await requestAndRegisterNotificationPermission(user);
                    if (res.success) {
                      setNotifPermission("granted");
                      toast.success("📱 Push notifications enabled on your phone!");
                    } else {
                      toast.error(res.error || "Please allow notifications in phone settings.");
                    }
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20"
                >
                  <span className="flex items-center gap-2">
                    <Smartphone className="size-4 text-amber-400" />
                    <span>Mobile Push Alerts</span>
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                    notifPermission === "granted"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  }`}>
                    {notifPermission === "granted" ? "ACTIVE ✓" : "ENABLE NOW"}
                  </span>
                </button>

                <div className="flex items-center justify-between px-2 py-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {isSuperAdmin ? (
                      <Crown className="size-4 text-amber-400" />
                    ) : (
                      <User className="size-4 text-primary" />
                    )}
                    <div>
                      <div className="truncate font-semibold text-foreground">{displayName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{user.email}</div>
                    </div>
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