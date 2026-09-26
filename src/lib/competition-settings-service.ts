/**
 * MedTrail Championship — Competition Settings Service
 * Manages dynamic global settings (e.g. competition_date) stored in Supabase.
 * All reads are public; writes are restricted to super admin in the app layer.
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompetitionSettings {
  /** UTC ISO 8601 string for when the season starts, or null if not set */
  competition_date: string | null;
  /** UTC ISO 8601 string for when the season ends, or null if not set */
  competition_end_date: string | null;
}

export interface SettingsRow {
  id: string;
  key: string;
  value: string | null;
  label: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ── Defaults (fallback when table has no value) ───────────────────────────────
const DEFAULT_SEASON_START = "2026-09-27T13:30:00.000Z";
const DEFAULT_SEASON_END = "2026-10-17T13:30:00.000Z";

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the current competition settings from Supabase.
 * Returns null for any value that hasn't been set.
 */
export async function fetchCompetitionSettings(): Promise<CompetitionSettings> {
  try {
    // Cast to any because championship_settings may not yet be in generated Supabase types
    const { data, error } = await (supabase as any)
      .from("championship_settings")
      .select("key, value")
      .in("key", ["competition_date", "competition_end_date"]);

    if (error) throw error;

    const map: Record<string, string | null> = {};
    (data ?? []).forEach((row: { key: string; value: string | null }) => {
      map[row.key] = row.value ?? null;
    });

    return {
      competition_date: map["competition_date"] ?? null,
      competition_end_date: map["competition_end_date"] ?? null,
    };
  } catch (err) {
    console.error("[CompetitionSettings] fetchCompetitionSettings error:", err);
    // Return defaults on error so the site still works
    return {
      competition_date: DEFAULT_SEASON_START,
      competition_end_date: DEFAULT_SEASON_END,
    };
  }
}

// ── Upsert ────────────────────────────────────────────────────────────────────

/**
 * Saves a competition setting value. Pass null to clear (show "TBA").
 * @param key  - Setting key ('competition_date' | 'competition_end_date')
 * @param value - UTC ISO 8601 string, or null to unset
 * @param updatedBy - Admin email for audit trail
 */
export async function saveCompetitionSetting(
  key: "competition_date" | "competition_end_date",
  value: string | null,
  updatedBy?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  try {
    // Cast to any because championship_settings may not yet be in generated Supabase types
    const { error } = await (supabase as any)
      .from("championship_settings")
      .upsert(
        {
          key,
          value,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy ?? null,
        },
        { onConflict: "key" }
      );

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    console.error("[CompetitionSettings] saveCompetitionSetting error:", err);
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}

// ── Realtime subscription ─────────────────────────────────────────────────────

/**
 * Subscribe to real-time changes to championship_settings.
 * Calls onUpdate whenever any setting changes in Supabase.
 * Returns an unsubscribe function.
 */
export function subscribeToCompetitionSettings(
  onUpdate: (settings: CompetitionSettings) => void
): () => void {
  const channel = supabase
    .channel("championship_settings_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_settings" },
      async () => {
        // Re-fetch all settings on any change
        const settings = await fetchCompetitionSettings();
        onUpdate(settings);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a UTC ISO date string as a friendly display date in IST.
 * Returns null if dateStr is null.
 */
export function formatCompetitionDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * Returns a Date object from a UTC ISO string, or null if not set.
 */
export function parseDateSetting(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Converts a local datetime-local input value (YYYY-MM-DDTHH:mm)
 * from IST to UTC ISO string, suitable for Supabase storage.
 */
export function istLocalToUTC(localISTString: string): string {
  // datetime-local gives "YYYY-MM-DDTHH:mm" in whatever the browser's timezone is.
  // We treat it as IST (UTC+5:30) by subtracting 5h30m.
  if (!localISTString) return "";
  // Parse as if it were UTC, then subtract 330 minutes (5:30)
  const asUTC = new Date(localISTString + ":00.000Z");
  const offsetMs = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30
  return new Date(asUTC.getTime() - offsetMs).toISOString();
}

/**
 * Converts a UTC ISO string to IST local datetime string for datetime-local input
 * Format: "YYYY-MM-DDTHH:mm"
 */
export function utcToISTLocal(utcISO: string | null): string {
  if (!utcISO) return "";
  try {
    const d = new Date(utcISO);
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(d.getTime() + offsetMs);
    // Format as YYYY-MM-DDTHH:mm
    return istDate.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}
