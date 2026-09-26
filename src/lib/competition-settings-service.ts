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

export const PULSE_SETTINGS_TABLE = "pulse_settings";
export const APP_SETTINGS_TABLE = "app_settings";
export const SETTINGS_EVENT = "medtrail_setting_updated";

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS: CompetitionSettings = {
  competition_date: null,
  competition_end_date: null,
  start_time: "19:00",
  end_time: "23:59",
  pulse_status: "upcoming",
  results_published: false,
  leaderboard_reset_at: null,
};

// ── Fetch all settings ────────────────────────────────────────────────────────

export async function fetchCompetitionSettings(): Promise<CompetitionSettings> {
  try {
    // Query Supabase pulse_settings table (row id = 1) - ONLY source of truth
    const { data: pulseRow, error: pulseErr } = await (supabase as any)
      .from("pulse_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (!pulseErr && pulseRow) {
      return {
        competition_date: pulseRow.competition_date ?? null,
        competition_end_date: pulseRow.competition_end_date ?? null,
        start_time: pulseRow.start_time ?? "19:00",
        end_time: pulseRow.end_time ?? "23:59",
        pulse_status: (pulseRow.pulse_status as PulseStatus) ?? "upcoming",
        results_published: pulseRow.results_published === true || pulseRow.results_published === "true",
        leaderboard_reset_at: pulseRow.leaderboard_reset_at ?? null,
      };
    }
  } catch (err) {
    console.warn("[CompetitionSettings] Supabase fetch error:", err);
  }

  return DEFAULTS;
}

// ── Save whole pulse settings record ──────────────────────────────────────────

export async function savePulseSettingsRecord(params: {
  competition_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  pulse_status?: PulseStatus;
  results_published?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  // Exact fields only: competition_date, start_time, end_time, pulse_status, results_published
  const updatePayload: Record<string, any> = {};

  if (params.competition_date !== undefined) {
    const raw = params.competition_date;
    updatePayload.competition_date = raw && raw.includes("T") ? raw.split("T")[0] : (raw || null);
  }
  if (params.start_time !== undefined) {
    updatePayload.start_time = params.start_time ? params.start_time.trim().slice(0, 8) : null;
  }
  if (params.end_time !== undefined) {
    updatePayload.end_time = params.end_time ? params.end_time.trim().slice(0, 8) : null;
  }
  if (params.pulse_status !== undefined) {
    updatePayload.pulse_status = params.pulse_status;
  }
  if (params.results_published !== undefined) {
    updatePayload.results_published = Boolean(params.results_published);
  }

  try {
    delete (updatePayload as any).id;

    const { error } = await (supabase as any)
      .from("pulse_settings")
      .update(updatePayload)
      .eq("id", 1);

    if (error) {
      console.error("[CompetitionSettings] pulse_settings update error:", error);
      return { success: false, error: error.message };
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: params }));
    }

    return { success: true };
  } catch (err: any) {
    console.error("[CompetitionSettings] pulse_settings save error:", err);
    return { success: false, error: err?.message || String(err) };
  }
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

  // 3. Persist to pulse_settings directly if the key belongs to pulse_settings (dates/publish only)
  // NOTE: pulse_status is strictly managed via Go Live / dedicated pulse controls, never overwritten here.
  const pulseFieldMap: Record<string, string> = {
    competition_date: "competition_date",
    start_time: "start_time",
    end_time: "end_time",
    results_published: "results_published",
  };

  if (pulseFieldMap[key]) {
    try {
      const field = pulseFieldMap[key]!;
      let val: any = value;
      if (key === "results_published") {
        val = value === "true";
      } else if (key === "competition_date" && value && value.includes("T")) {
        val = value.split("T")[0];
      }

      await (supabase as any)
        .from("pulse_settings")
        .update({ [field]: val })
        .eq("id", 1);
    } catch (err) {
      console.warn("[CompetitionSettings] pulse_settings write notice:", err);
    }
  }

  // 4. Persist to Supabase app_settings
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

  // 5. Also mirror to championship_settings as secondary persistence
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
            start_time: row.start_time ?? "19:00",
            end_time: row.end_time ?? "23:59",
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

export function formatCompetitionTime(timeOrDateStr: string | null): string | null {
  if (!timeOrDateStr) return null;
  try {
    const trimmed = timeOrDateStr.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
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
    if (dateStr.includes("T")) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d;
    }
    const ymd = dateStr.trim().slice(0, 10);
    const time = timeStr && timeStr.trim() ? timeStr.trim() : "19:00";
    const [hh, mm] = time.split(":").map(Number);
    const hour = isNaN(hh!) ? 19 : hh!;
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
