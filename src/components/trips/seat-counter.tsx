import { useEffect, useState, useRef } from "react";
import { Users, AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchRemainingSeats, RAJGAD_TRIP } from "@/lib/trip-service";
import { supabase } from "@/integrations/supabase/client";

interface SeatCounterProps {
  tripId?: string;
  maxSeats?: number;
  className?: string;
  onSeatsLoaded?: (remaining: number, isSoldOut: boolean) => void;
}

export function SeatCounter({
  tripId = RAJGAD_TRIP.id,
  maxSeats = RAJGAD_TRIP.totalSeats,
  className,
  onSeatsLoaded,
}: SeatCounterProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSeats: maxSeats,
    bookedSeats: 0,
    remainingSeats: maxSeats,
    isSoldOut: false,
  });

  const onSeatsLoadedRef = useRef(onSeatsLoaded);
  useEffect(() => {
    onSeatsLoadedRef.current = onSeatsLoaded;
  }, [onSeatsLoaded]);

  useEffect(() => {
    let mounted = true;

    async function loadSeats() {
      try {
        const data = await fetchRemainingSeats(tripId, maxSeats);
        if (mounted) {
          setStats(data);
          setLoading(false);
          onSeatsLoadedRef.current?.(data.remainingSeats, data.isSoldOut);
        }
      } catch (e) {
        console.warn("Error loading seats", e);
        if (mounted) setLoading(false);
      }
    }

    loadSeats();

    // Unique channel identifier per component instance to prevent duplicate channel collision in Supabase Realtime
    const channelId = `seat_counter_${tripId}_${Math.random().toString(36).substring(2, 9)}`;
    let channel: any = null;

    try {
      channel = supabase
        .channel(channelId)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "trip_registrations",
            filter: `trip_id=eq.${tripId}`,
          },
          () => {
            loadSeats();
          },
        )
        .subscribe();
    } catch (err) {
      console.warn("Supabase realtime subscription error:", err);
    }

    // Polling fallback every 15s to keep seats fresh
    const interval = setInterval(loadSeats, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (e) {
          console.warn("Error removing channel:", e);
        }
      }
    };
  }, [tripId, maxSeats]);

  const bookedPercent = Math.min(100, Math.round((stats.bookedSeats / stats.totalSeats) * 100));
  const isUrgent = stats.remainingSeats > 0 && stats.remainingSeats <= 5;

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-all duration-300",
        stats.isSoldOut
          ? "border-destructive/30 bg-destructive/5"
          : isUrgent
            ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20"
            : "border-primary/20 bg-primary/5 dark:bg-emerald-950/20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              stats.isSoldOut
                ? "bg-destructive/15 text-destructive"
                : isUrgent
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-primary/15 text-primary",
            )}
          >
            {stats.isSoldOut ? (
              <AlertTriangle className="size-4.5" />
            ) : isUrgent ? (
              <Flame className="size-4.5 animate-pulse" />
            ) : (
              <Users className="size-4.5" />
            )}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">
                {stats.isSoldOut ? (
                  <span className="text-destructive font-bold">SOLD OUT</span>
                ) : (
                  <span>
                    <strong className="text-base text-foreground">
                      {loading ? "..." : stats.remainingSeats}
                    </strong>{" "}
                    of {stats.totalSeats} seats remaining
                  </span>
                )}
              </span>
              {stats.isSoldOut ? (
                <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-destructive">
                  Full
                </span>
              ) : isUrgent ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 animate-pulse">
                  Fast filling
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3" /> Live
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stats.isSoldOut
                ? "Maximum capacity (17 medical students) reached."
                : `${stats.bookedSeats} students registered · Limited batch size`}
            </p>
          </div>
        </div>

        {/* Capacity badge */}
        <div className="hidden sm:block text-right">
          <span className="text-xs font-medium text-muted-foreground">Capacity</span>
          <p className="font-display text-sm font-bold text-foreground">17 Seats</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              stats.isSoldOut
                ? "bg-destructive"
                : isUrgent
                  ? "bg-gradient-to-r from-amber-500 to-amber-600"
                  : "bg-gradient-to-r from-emerald-600 to-primary",
            )}
            style={{ width: `${bookedPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
