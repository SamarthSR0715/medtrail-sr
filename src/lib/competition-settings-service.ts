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

// ── Types ─────────────────────────────────────────────────────────────────────

export type PulseStatus = "upcoming" | "live" | "paused" | "ended";

export interface CompetitionSettings {
  competition_date: string | null;
  competition_end_date: string | null;
  pulse_status: PulseStatus;
  results_published: boolean;
  leaderboard_reset_at: string | null;
}

export type SettingKey =
  | "competition_date"
  | "competition_end_date"
  | "pulse_status"
  | "results_published"
  | "leaderboard_reset_at";

export interface LiveLeaderboardEntry {
  rank: number;
  participant_id: string;
  display_name: string;
  institution: string | null;
  score: number;
  time_taken_seconds: number;
  submitted_at: string | null;
  accuracy: number;
  is_current_user?: boolean;
}

export const APP_SETTINGS_TABLE = "app_settings";
export const SETTINGS_EVENT = "medtrail_setting_updated";
const LOCAL_STORAGE_PREFIX = "medtrail_setting_";

export function getCachedSetting(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

export function setCachedSetting(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value !== null && value !== undefined) {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, value);
    } else {
      localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    }
  } catch {
    // Ignore storage quota or disabled storage
  }
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS: CompetitionSettings = {
  competition_date: null,
  competition_end_date: null,
  pulse_status: "upcoming",
  results_published: false,
  leaderboard_reset_at: null,
};

// ── Fetch all settings ────────────────────────────────────────────────────────

export async function fetchCompetitionSettings(): Promise<CompetitionSettings> {
  // 1. Initial values from local cache
  const map: Record<string, string | null> = {
    competition_date: getCachedSetting("competition_date"),
    competition_end_date: getCachedSetting("competition_end_date"),
    pulse_status: getCachedSetting("pulse_status"),
    results_published: getCachedSetting("results_published"),
    leaderboard_reset_at: getCachedSetting("leaderboard_reset_at"),
  };

  try {
    // 2. Query Supabase app_settings table first (key, value)
    const { data: appData, error: appErr } = await (supabase as any)
      .from("app_settings")
      .select("key, value");

    if (!appErr && appData && appData.length > 0) {
      appData.forEach((row: { key: string; value: string | null }) => {
        map[row.key] = row.value ?? null;
        setCachedSetting(row.key, row.value ?? null);
      });
    } else {
      // Fallback: check championship_settings
      const { data: champData } = await (supabase as any)
        .from("championship_settings")
        .select("key, value");

      if (champData && champData.length > 0) {
        champData.forEach((row: { key: string; value: string | null }) => {
          if (map[row.key] === null || map[row.key] === undefined) {
            map[row.key] = row.value ?? null;
            setCachedSetting(row.key, row.value ?? null);
          }
        });
      }
    }
  } catch (err) {
    console.warn("[CompetitionSettings] Supabase fetch error, using cached settings:", err);
  }

  return {
    competition_date: map["competition_date"] ?? null,
    competition_end_date: map["competition_end_date"] ?? null,
    pulse_status: (map["pulse_status"] as PulseStatus) ?? "upcoming",
    results_published: map["results_published"] === "true",
    leaderboard_reset_at: map["leaderboard_reset_at"] ?? null,
  };
}

// ── Generic upsert ────────────────────────────────────────────────────────────

export async function saveCompetitionSetting(
  key: SettingKey,
  value: string | null,
  updatedBy?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  // 1. Immediately cache in localStorage for instant UI responsiveness
  setCachedSetting(key, value);

  // 2. Dispatch custom event so all active components refresh immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SETTINGS_EVENT, { detail: { key, value } })
    );
  }

  // 3. Persist to Supabase app_settings
  let supabaseSuccess = false;
  let lastError: any = null;

  try {
    const { error: appErr } = await (supabase as any)
      .from("app_settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    if (!appErr) {
      supabaseSuccess = true;
    } else {
      // Retry with just { key, value } in case updated_at column does not exist
      const { error: retryErr } = await (supabase as any)
        .from("app_settings")
        .upsert({ key, value }, { onConflict: "key" });

      if (!retryErr) {
        supabaseSuccess = true;
      } else {
        lastError = retryErr;
      }
    }
  } catch (err) {
    lastError = err;
  }

  // 4. Also mirror to championship_settings as secondary persistence
  try {
    await (supabase as any)
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
  } catch {
    // Ignore secondary table mirror error
  }

  if (lastError && !supabaseSuccess) {
    console.warn("[CompetitionSettings] Supabase write warning:", lastError);
  }

  return { success: true };
}

// ── Admin control shortcuts ───────────────────────────────────────────────────

export async function setPulseStatus(
  status: PulseStatus,
  adminEmail?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return saveCompetitionSetting("pulse_status", status, adminEmail);
}

export async function setResultsPublished(
  published: boolean,
  adminEmail?: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return saveCompetitionSetting("results_published", String(published), adminEmail);
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
 * Fetches live leaderboard from championship_pulse_attempts with enrichment from
 * championship_participants and championship_registrations.
 * Ranking order:
 *  1) Highest score (score DESC)
 *  2) Lowest completion time (time_taken_seconds ASC)
 *  3) Earliest submission (completed_at ASC)
 */
export async function fetchLiveLeaderboard(
  currentUserEmail?: string | null,
  limit = 50
): Promise<LiveLeaderboardEntry[]> {
  try {
    // 1. Query pulse attempts
    const { data: attempts, error: attemptsError } = await (supabase as any)
      .from("championship_pulse_attempts")
      .select("*")
      .order("score", { ascending: false })
      .order("time_taken_seconds", { ascending: true })
      .order("completed_at", { ascending: true })
      .limit(limit);

    if (!attemptsError && attempts && attempts.length > 0) {
      // Collect user_ids and emails to enrich names/colleges
      const userIds = attempts.map((a: any) => a.user_id).filter(Boolean);
      const emails = attempts.map((a: any) => a.user_email).filter(Boolean);

      // Fetch participants and registrations for name/college mapping
      const participantMap = new Map<string, { name: string; college: string }>();
      if (userIds.length > 0) {
        try {
          const { data: pData } = await (supabase as any)
            .from("championship_participants")
            .select("user_id, display_name, institution")
            .in("user_id", userIds);

          if (pData) {
            for (const p of pData) {
              if (p.user_id) {
                participantMap.set(p.user_id, {
                  name: p.display_name,
                  college: p.institution,
                });
              }
            }
          }
        } catch {
          // ignore lookup errors
        }
      }

      const registrationMap = new Map<string, { name: string; college: string }>();
      if (emails.length > 0) {
        try {
          const { data: rData } = await (supabase as any)
            .from("championship_registrations")
            .select("email, full_name, medical_college")
            .in("email", emails);

          if (rData) {
            for (const r of rData) {
              if (r.email) {
                registrationMap.set(r.email.toLowerCase(), {
                  name: r.full_name,
                  college: r.medical_college,
                });
              }
            }
          }
        } catch {
          // ignore lookup errors
        }
      }

      // Deduplicate by user_id or user_email (keep best attempt)
      const seen = new Set<string>();
      const uniqueAttempts: any[] = [];
      for (const a of attempts) {
        const key = a.user_id || a.user_email || a.id;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueAttempts.push(a);
        }
      }

      // Strict ranking: 1) score DESC, 2) time_taken_seconds ASC, 3) completed_at ASC
      uniqueAttempts.sort((a, b) => {
        const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const timeA = Number(a.time_taken_seconds ?? 0);
        const timeB = Number(b.time_taken_seconds ?? 0);
        if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeA - timeB;
        const dateA = new Date(a.completed_at || a.created_at || 0).getTime();
        const dateB = new Date(b.completed_at || b.created_at || 0).getTime();
        return dateA - dateB;
      });

      return uniqueAttempts.map((row, idx) => {
        const email = row.user_email?.toLowerCase();
        const regInfo = email ? registrationMap.get(email) : null;
        const partInfo = row.user_id ? participantMap.get(row.user_id) : null;

        const displayName =
          row.student_name ||
          partInfo?.name ||
          regInfo?.name ||
          (email ? email.split("@")[0] : `Participant #${idx + 1}`);

        const college =
          row.college ||
          partInfo?.college ||
          regInfo?.college ||
          "Medical College";

        const isCurrentUser =
          currentUserEmail && email
            ? email === currentUserEmail.toLowerCase()
            : false;

        return {
          rank: idx + 1,
          participant_id: row.participant_id || row.user_id || row.id,
          display_name: displayName,
          institution: college,
          score: Number(row.score ?? 0),
          time_taken_seconds: Number(row.time_taken_seconds ?? 0),
          submitted_at: row.completed_at || null,
          accuracy: Number(row.accuracy ?? 0),
          is_current_user: isCurrentUser,
        };
      });
    }

    return fetchLeaderboardFromParticipants(currentUserEmail, limit);
  } catch {
    return fetchLeaderboardFromParticipants(currentUserEmail, limit);
  }
}

/** Fallback 1: read from championship_participants table */
async function fetchLeaderboardFromParticipants(
  currentUserEmail?: string | null,
  limit = 50
): Promise<LiveLeaderboardEntry[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_participants")
      .select(
        "id, user_id, display_name, full_name, institution, total_score, total_accuracy_pct, registered_at"
      )
      .eq("season_id", "S1")
      .eq("status", "active")
      .order("total_score", { ascending: false })
      .order("total_accuracy_pct", { ascending: false })
      .order("registered_at", { ascending: true })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return fetchLeaderboardFromRegistrations(currentUserEmail, limit);
    }

    return (data as any[]).map((p, idx) => ({
      rank: idx + 1,
      participant_id: p.id,
      display_name: p.display_name || p.full_name || `Doctor #${idx + 1}`,
      institution: p.institution ?? "Medical College",
      score: Number(p.total_score ?? 0),
      time_taken_seconds: 0,
      submitted_at: p.registered_at ?? null,
      accuracy: Number(p.total_accuracy_pct ?? 0),
      is_current_user: false,
    }));
  } catch {
    return fetchLeaderboardFromRegistrations(currentUserEmail, limit);
  }
}

/** Fallback 2: read from championship_registrations table */
async function fetchLeaderboardFromRegistrations(
  currentUserEmail?: string | null,
  limit = 50
): Promise<LiveLeaderboardEntry[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_registrations")
      .select("id, full_name, email, medical_college, created_at")
      .limit(limit);

    if (error || !data || data.length === 0) return [];

    return (data as any[]).map((r, idx) => ({
      rank: idx + 1,
      participant_id: r.id,
      display_name: r.full_name || "Doctor",
      institution: r.medical_college || "Medical College",
      score: 0,
      time_taken_seconds: 0,
      submitted_at: r.created_at ?? null,
      accuracy: 0,
      is_current_user: currentUserEmail
        ? (r.email ?? "").toLowerCase() === currentUserEmail.toLowerCase()
        : false,
    }));
  } catch {
    return [];
  }
}

// ── Real-time subscription ────────────────────────────────────────────────────

export function subscribeToCompetitionSettings(
  onUpdate: (settings: CompetitionSettings) => void
): () => void {
  const channel = supabase
    .channel("app_settings_realtime_v3")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_settings" },
      async () => {
        const settings = await fetchCompetitionSettings();
        onUpdate(settings);
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_settings" },
      async () => {
        const settings = await fetchCompetitionSettings();
        onUpdate(settings);
      }
    )
    .subscribe();

  // Instant local dispatch handler for zero-latency in-browser sync
  const handleLocalUpdate = async () => {
    const settings = await fetchCompetitionSettings();
    onUpdate(settings);
  };

  if (typeof window !== "undefined") {
    window.addEventListener(SETTINGS_EVENT, handleLocalUpdate);
    window.addEventListener("storage", handleLocalUpdate);
  }

  return () => {
    supabase.removeChannel(channel);
    if (typeof window !== "undefined") {
      window.removeEventListener(SETTINGS_EVENT, handleLocalUpdate);
      window.removeEventListener("storage", handleLocalUpdate);
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
    return new Date(dateStr).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
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

export function formatCompetitionTime(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return (
      new Date(dateStr).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }) + " IST"
    );
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
