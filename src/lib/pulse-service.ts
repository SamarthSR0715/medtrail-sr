import { supabase } from "@/integrations/supabase/client";
import { fetchLeaderboardForCurrentPulse } from "./leaderboard-engine";

export type PulseStatus = "upcoming" | "live" | "paused" | "ended";

export interface PulseSettings {
  id?: number;
  competition_date: string | null;
  competition_end_date?: string | null;
  start_time: string | null;
  end_time: string | null;
  pulse_status: PulseStatus;
  results_published: boolean;
}

export interface PulseAttemptLeaderboardEntry {
  rank: number;
  id: string;
  user_id: string;
  student_name: string;
  college: string;
  score: number;
  total_score?: number;
  correct_answers?: number;
  wrong_answers?: number;
  accuracy: number;
  time_taken_seconds: number;
  completed_at: string | null;
  is_current_user?: boolean;
}

/**
 * Single source of truth for pulse_settings in MedTrail.
 * Rules:
 * - Always UPDATE row id = 1
 * - Never INSERT
 * - Never UPSERT
 * - Never write the 'id' field in the update payload
 */

/**
 * Fetch current pulse settings from pulse_settings
 */
export async function getPulseSettings(): Promise<PulseSettings> {
  try {
    const { data, error } = await (supabase as any)
      .from("pulse_settings")
      .select("id, competition_date, competition_end_date, start_time, end_time, pulse_status, results_published")
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        competition_date: data.competition_date ?? null,
        competition_end_date: data.competition_end_date ?? null,
        start_time: data.start_time ?? null,
        end_time: data.end_time ?? null,
        pulse_status: (data.pulse_status as PulseStatus) ?? "upcoming",
        results_published: Boolean(data.results_published),
      };
    }

    return {
      competition_date: null,
      competition_end_date: null,
      start_time: null,
      end_time: null,
      pulse_status: "upcoming",
      results_published: false,
    };
  } catch (err) {
    console.error("[pulse-service] getPulseSettings error:", err);
    return {
      competition_date: null,
      competition_end_date: null,
      start_time: null,
      end_time: null,
      pulse_status: "upcoming",
      results_published: false,
    };
  }
}

/**
 * Helper to execute UPDATE on pulse_settings
 * Strips 'id' field and prevents any INSERT/UPSERT.
 */
async function updatePulseSettingsRow(payload: Partial<PulseSettings>): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanPayload: Record<string, any> = { ...payload };
    delete cleanPayload.id;

    // Find the single record and update by its actual id
    const { data: existing, error: fetchErr } = await (supabase as any)
      .from("pulse_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (fetchErr || !existing || existing.id === undefined || existing.id === null) {
      const msg = fetchErr?.message || "No pulse_settings record found in database.";
      console.error("[pulse-service] Could not find pulse_settings row:", msg);
      return { success: false, error: msg };
    }

    const { error } = await (supabase as any)
      .from("pulse_settings")
      .update(cleanPayload)
      .eq("id", existing.id);

    if (error) {
      console.error(`[pulse-service] update error on id=${existing.id}:`, error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[pulse-service] update exception:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Save schedule: competition_date, competition_end_date, start_time, end_time
 */
export async function saveSchedule(params: {
  competition_date?: string | null;
  competition_end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const updatePayload: Partial<PulseSettings> = {};
  if (params.competition_date !== undefined) {
    updatePayload.competition_date = params.competition_date ? params.competition_date.split("T")[0] : null;
  }
  if (params.competition_end_date !== undefined) {
    updatePayload.competition_end_date = params.competition_end_date ? params.competition_end_date.split("T")[0] : null;
  }
  if (params.start_time !== undefined) {
    updatePayload.start_time = params.start_time ? params.start_time.trim().slice(0, 8) : null;
  }
  if (params.end_time !== undefined) {
    updatePayload.end_time = params.end_time ? params.end_time.trim().slice(0, 8) : null;
  }
  return updatePulseSettingsRow(updatePayload);
}

/**
 * Go Live: sets pulse_status = "live"
 */
export async function goLive(): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ pulse_status: "live" });
}

/**
 * Pause Pulse: sets pulse_status = "paused"
 */
export async function pausePulse(): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ pulse_status: "paused" });
}

/**
 * End Pulse: sets pulse_status = "ended"
 */
export async function endPulse(): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ pulse_status: "ended" });
}

/**
 * Publish Results: sets results_published = true (never modifies pulse_status)
 */
export async function publishResults(): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ results_published: true });
}

/**
 * Hide Results: sets results_published = false (never modifies pulse_status)
 */
export async function hideResults(): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ results_published: false });
}

/**
 * Set Results Published state (never modifies pulse_status)
 */
export async function setResultsPublished(published: boolean): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({ results_published: published });
}

/**
 * Real-time subscription to pulse_settings table
 */
export function subscribeToPulseStatus(
  onUpdate: (settings: PulseSettings) => void
): () => void {
  const channel = supabase
    .channel("pulse_settings_realtime_channel")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pulse_settings" },
      async (payload: any) => {
        if (payload?.new) {
          const row = payload.new;
          onUpdate({
            id: row.id,
            competition_date: row.competition_date ?? null,
            competition_end_date: row.competition_end_date ?? null,
            start_time: row.start_time ?? null,
            end_time: row.end_time ?? null,
            pulse_status: (row.pulse_status as PulseStatus) ?? "upcoming",
            results_published: Boolean(row.results_published),
          });
        } else {
          const fresh = await getPulseSettings();
          onUpdate(fresh);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Fetch dynamic live leaderboard from championship_pulse_attempts
 * filtered by the current pulse_set_id only.
 * Ranking order:
 * 1) Highest score (score DESC)
 * 2) Highest accuracy (accuracy DESC)
 * 3) Lowest completion time (time_taken_seconds ASC)
 * 4) Earliest submission (completed_at ASC)
 */
export async function fetchPulseLeaderboard(
  currentUserEmail?: string | null,
  limit = 50,
  pulseSetId?: string | null,
  pulseDate?: string | null
): Promise<PulseAttemptLeaderboardEntry[]> {
  try {
    const result = await fetchLeaderboardForCurrentPulse({
      currentUserEmail,
      pulseSetId,
      pulseDate,
    });

    return result.entries.slice(0, limit).map((entry) => ({
      rank: entry.rank,
      id: entry.participant_id,
      user_id: entry.participant_id,
      student_name: entry.display_name,
      college: entry.institution,
      score: entry.score,
      total_score: entry.total_score,
      correct_answers: entry.correct_answers,
      wrong_answers: entry.wrong_answers,
      accuracy: entry.accuracy,
      time_taken_seconds: entry.time_taken_seconds,
      completed_at: entry.submitted_at,
      is_current_user: entry.is_current_user,
    }));
  } catch (err) {
    console.error("[pulse-service] fetchPulseLeaderboard error:", err);
    return [];
  }
}

/**
 * Real-time subscription to leaderboard updates
 */
export function subscribeToPulseLeaderboard(onUpdate: () => void): () => void {
  const channel = supabase
    .channel("pulse_leaderboard_realtime_channel")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_pulse_attempts" },
      () => onUpdate()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
