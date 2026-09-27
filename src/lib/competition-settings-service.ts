/**
 * MedTrail Championship — Competition Settings Service v2
 * Manages ALL dynamic global settings stored in Supabase championship_settings.
 * Public read · Admin write (enforced by app-layer guard + Supabase RLS)
 *
 * Keys managed:
 *   competition_date     – UTC ISO 8601 season start
 *   competition_end_date – UTC ISO 8601 season end
 *   pulse_status         – "upcoming" | "live" | "paused" | "ended"
 *   results_published    – "true" | "false"
 *   leaderboard_reset_at – UTC ISO timestamp of last reset (or null)
 */

import { supabase } from "@/integrations/supabase/client";
import { getPulseSettings } from "@/lib/pulse-service";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PulseStatus = "upcoming" | "live" | "paused" | "ended";

export interface CompetitionSettings {
  competition_date: string | null;
  competition_end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  pulse_status: PulseStatus;
  results_published: boolean;
  leaderboard_reset_at: string | null;
}

export type SettingKey =
  | "competition_date"
  | "competition_end_date"
  | "start_time"
  | "end_time"
  | "pulse_status"
  | "results_published"
  | "leaderboard_reset_at";

import { fetchLeaderboardForCurrentPulse, type LeaderboardStudentEntry } from "./leaderboard-engine";

export interface LiveLeaderboardEntry {
  rank: number;
  participant_id: string;
  display_name: string;
  institution: string | null;
  batch?: string;
  score: number;
  total_score?: number;
  correct_answers?: number;
  wrong_answers?: number;
  time_taken_seconds: number;
  submitted_at: string | null;
  accuracy: number;
  is_current_user?: boolean;
}

export const PULSE_SETTINGS_TABLE = "pulse_settings";
export const APP_SETTINGS_TABLE = "app_settings";
export const SETTINGS_EVENT = "medtrail_setting_updated";

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS: CompetitionSettings = {
  competition_date: null,
  competition_end_date: null,
  start_time: null,
  end_time: null,
  pulse_status: "upcoming",
  results_published: false,
  leaderboard_reset_at: null,
};

// ── Fetch all settings ────────────────────────────────────────────────────────

export async function fetchCompetitionSettings(): Promise<CompetitionSettings> {
  try {
    const pulse = await getPulseSettings();
    return {
      competition_date: pulse.competition_date ?? null,
      competition_end_date: pulse.competition_end_date ?? null,
      start_time: pulse.start_time ?? null,
      end_time: pulse.end_time ?? null,
      pulse_status: pulse.pulse_status,
      results_published: pulse.results_published,
      leaderboard_reset_at: null,
    };
  } catch (err) {
    console.warn("[CompetitionSettings] fetch error:", err);
    return DEFAULTS;
  }
}

// ── Save whole pulse settings record ──────────────────────────────────────────

export async function savePulseSettingsRecord(params: {
  competition_date?: string | null;
  competition_end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  pulse_status?: PulseStatus;
  results_published?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, any> = {};

    if (params.pulse_status !== undefined) {
      payload.pulse_status = params.pulse_status;
    }
    if (params.results_published !== undefined) {
      payload.results_published = Boolean(params.results_published);
    }
    if (params.competition_date !== undefined) {
      payload.competition_date = params.competition_date
        ? params.competition_date.split("T")[0]
        : null;
    }
    if (params.competition_end_date !== undefined) {
      payload.competition_end_date = params.competition_end_date
        ? params.competition_end_date.split("T")[0]
        : null;
    }
    if (params.start_time !== undefined) {
      payload.start_time = params.start_time ? params.start_time.trim().slice(0, 8) : null;
    }
    if (params.end_time !== undefined) {
      payload.end_time = params.end_time ? params.end_time.trim().slice(0, 8) : null;
    }

    if (Object.keys(payload).length === 0) {
      return { success: true };
    }

    // Direct update to existing pulse_settings row
    const { data: existing, error: fetchErr } = await (supabase as any)
      .from("pulse_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (fetchErr || !existing || existing.id === undefined || existing.id === null) {
      const msg = fetchErr?.message || "No pulse_settings record found in database.";
      console.error("[CompetitionSettings] Could not find pulse_settings row:", msg);
      return { success: false, error: msg };
    }

    const { error } = await (supabase as any)
      .from("pulse_settings")
      .update(payload)
      .eq("id", existing.id);

    if (error) {
      console.error("[CompetitionSettings] pulse_settings save error:", error);
      return { success: false, error: error.message };
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: params }));
    }

    return { success: true };
  } catch (err: any) {
    console.error("[CompetitionSettings] save error:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ── Generic upsert ────────────────────────────────────────────────────────────

export async function saveCompetitionSetting(
  key: SettingKey,
  value: string | null,
  updatedBy?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  // 1. Dispatch custom event so all active components refresh immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SETTINGS_EVENT, { detail: { key, value } })
    );
  }

  // 2. Map supported settings directly to the existing pulse_settings row
  const payload: Record<string, any> = {};

  if (key === "competition_date") {
    payload.competition_date = value ? value.split("T")[0] : null;
    if (value && value.includes("T")) {
      const timePart = value.split("T")[1]?.trim().slice(0, 5);
      if (timePart) {
        payload.start_time = timePart;
      }
    }
  } else if (key === "competition_end_date") {
    payload.competition_end_date = value
      ? (value.includes("T") ? value.split("T")[0] : value.trim().slice(0, 10))
      : null;
    if (value && value.includes("T")) {
      const timePart = value.split("T")[1]?.trim().slice(0, 5);
      if (timePart) {
        payload.end_time = timePart;
      }
    }
  } else if (key === "start_time") {
    payload.start_time = value ? value.trim().slice(0, 8) : null;
  } else if (key === "end_time") {
    payload.end_time = value ? value.trim().slice(0, 8) : null;
  } else if (key === "pulse_status") {
    payload.pulse_status = (value as PulseStatus) || "upcoming";
  } else if (key === "results_published") {
    payload.results_published = value === "true" || value === true;
  }

  if (Object.keys(payload).length > 0) {
    try {
      const { data: existing, error: fetchErr } = await (supabase as any)
        .from("pulse_settings")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (fetchErr || !existing || existing.id === undefined || existing.id === null) {
        const msg = fetchErr?.message || "No pulse_settings record found in database.";
        console.error("[CompetitionSettings] Could not find pulse_settings row:", msg);
        return { success: false, error: msg };
      }

      const { error } = await (supabase as any)
        .from("pulse_settings")
        .update(payload)
        .eq("id", existing.id);

      if (error) {
        console.error("[CompetitionSettings] pulse_settings save error:", error);
        return { success: false, error: error.message };
      }
    } catch (err: any) {
      console.error("[CompetitionSettings] pulse_settings save exception:", err);
      return { success: false, error: err?.message || String(err) };
    }
  }

  return { success: true };
}

// ── Admin control shortcuts ───────────────────────────────────────────────────

export async function setPulseStatus(
  status: PulseStatus,
  adminEmail?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return savePulseSettingsRecord({ pulse_status: status });
}

export async function setResultsPublished(
  published: boolean,
  adminEmail?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return savePulseSettingsRecord({ results_published: published });
}

export async function resetLeaderboard(
  adminEmail?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return saveCompetitionSetting(
    "leaderboard_reset_at",
    new Date().toISOString(),
    adminEmail
  );
}

// ── Real-time leaderboard ─────────────────────────────────────────────────────

/**
 * Fetches live leaderboard strictly from championship_pulse_attempts
 * filtered by the current pulse_set_id only.
 * Ranking order:
 *  1) Highest score (score DESC)
 *  2) Highest accuracy (accuracy DESC)
 *  3) Lowest time taken (time_taken_seconds ASC)
 *  4) Earliest submission (submitted_at ASC)
 */
export async function fetchLiveLeaderboard(
  currentUserEmail?: string | null,
  limit = 50,
  pulseSetId?: string | null,
  pulseDate?: string | null
): Promise<LiveLeaderboardEntry[]> {
  try {
    const result = await fetchLeaderboardForCurrentPulse({
      currentUserEmail,
      pulseSetId,
      pulseDate,
    });

    const entries = result.entries.slice(0, limit).map((entry) => ({
      rank: entry.rank,
      participant_id: entry.participant_id,
      display_name: entry.display_name,
      institution: entry.institution,
      batch: entry.batch,
      score: entry.score,
      total_score: entry.total_score,
      correct_answers: entry.correct_answers,
      wrong_answers: entry.wrong_answers,
      accuracy: entry.accuracy,
      time_taken_seconds: entry.time_taken_seconds,
      submitted_at: entry.submitted_at,
      is_current_user: entry.is_current_user,
    }));

    return entries;
  } catch (err) {
    console.error("[competition-settings-service] fetchLiveLeaderboard error:", err);
    return [];
  }
}

// ── Real-time subscription ────────────────────────────────────────────────────

export function subscribeToCompetitionSettings(
  onUpdate: (settings: CompetitionSettings) => void
): () => void {
  const channel = supabase
    .channel("pulse_settings_realtime_stream_v1")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pulse_settings" },
      async (payload: any) => {
        if (payload?.new) {
          const row = payload.new;
          const newSettings: CompetitionSettings = {
            competition_date: row.competition_date ?? null,
            competition_end_date: row.competition_end_date ?? null,
            start_time: row.start_time ?? null,
            end_time: row.end_time ?? null,
            pulse_status: (row.pulse_status as PulseStatus) ?? "upcoming",
            results_published: row.results_published === true || row.results_published === "true",
            leaderboard_reset_at: row.leaderboard_reset_at ?? null,
          };
          onUpdate(newSettings);
        } else {
          const settings = await fetchCompetitionSettings();
          onUpdate(settings);
        }
      }
    )
    .subscribe();

  const handleLocalUpdate = async (e?: any) => {
    if (e?.detail) {
      const current = await fetchCompetitionSettings();
      onUpdate({ ...current, ...e.detail });
    } else {
      const settings = await fetchCompetitionSettings();
      onUpdate(settings);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener(SETTINGS_EVENT, handleLocalUpdate);
  }

  return () => {
    supabase.removeChannel(channel);
    if (typeof window !== "undefined") {
      window.removeEventListener(SETTINGS_EVENT, handleLocalUpdate);
    }
  };
}

export function subscribeToLeaderboard(
  onUpdate: () => void
): () => void {
  const channel = supabase
    .channel("championship_leaderboard_realtime_v2")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_pulse_attempts" },
      () => onUpdate()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_participants" },
      () => onUpdate()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_registrations" },
      () => onUpdate()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function formatCompetitionDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const ymd = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr.trim().slice(0, 10);
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export function formatCompetitionDateTime(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
}

export function formatCompetitionTime(timeOrDateStr: string | null): string | null {
  if (!timeOrDateStr) return null;
  try {
    const trimmed = timeOrDateStr.trim();
    if (/^\d{1,2}:\d{2}/.test(trimmed)) {
      const [hStr, mStr] = trimmed.split(":");
      let h = parseInt(hStr!, 10);
      const m = parseInt(mStr!, 10);
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return `${h}:${String(m).padStart(2, "0")} ${ampm} IST`;
    }
    return (
      new Date(timeOrDateStr).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " IST"
    );
  } catch {
    return null;
  }
}

/** Combine a date string (YYYY-MM-DD or ISO) and a time string (HH:mm) into a UTC Date object */
export function combineDateAndTime(
  dateStr: string | null,
  timeStr: string | null
): Date | null {
  if (!dateStr) return null;
  try {
    if (!timeStr && dateStr.includes("T")) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d;
    }
    const ymd = dateStr.trim().slice(0, 10);
    const time = timeStr && timeStr.trim() ? timeStr.trim() : "00:00";
    const [hh, mm] = time.split(":").map(Number);
    const hour = isNaN(hh!) ? 0 : hh!;
    const minute = isNaN(mm!) ? 0 : mm!;
    const pad = (n: number) => String(n).padStart(2, "0");
    const istISO = `${ymd}T${pad(hour)}:${pad(minute)}:00+05:30`;
    const d = new Date(istISO);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function parseDateSetting(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** IST datetime-local string → UTC ISO */
export function istLocalToUTC(localISTString: string): string {
  if (!localISTString) return "";
  const asUTC = new Date(localISTString + ":00.000Z");
  const offsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(asUTC.getTime() - offsetMs).toISOString();
}

/** UTC ISO → IST datetime-local string (YYYY-MM-DDTHH:mm) */
export function utcToISTLocal(utcISO: string | null): string {
  if (!utcISO) return "";
  try {
    const d = new Date(utcISO);
    const offsetMs = 5.5 * 60 * 60 * 1000;
    return new Date(d.getTime() + offsetMs).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

/** Format seconds as HH:MM:SS */
export function formatTimeTaken(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Compute season status purely from dates — no hardcoded constants.
 */
export function computeSeasonStatus(
  now: Date,
  startDate: Date | null,
  endDate: Date | null
): "pre" | "live" | "ended" {
  if (!startDate) return "pre";
  if (now < startDate) return "pre";
  if (endDate && now >= endDate) return "ended";
  return "live";
}
