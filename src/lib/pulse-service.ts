import { supabase } from "@/integrations/supabase/client";

export type PulseStatus = "upcoming" | "live" | "paused" | "ended";

export interface PulseSettings {
  id?: number;
  competition_date: string | null;
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
 * Fetch current pulse settings from pulse_settings (id = 1)
 */
export async function getPulseSettings(): Promise<PulseSettings> {
  try {
    const { data, error } = await (supabase as any)
      .from("pulse_settings")
      .select("competition_date, start_time, end_time, pulse_status, results_published")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      // Fallback query if id is not 1
      const { data: fallback } = await (supabase as any)
        .from("pulse_settings")
        .select("competition_date, start_time, end_time, pulse_status, results_published")
        .limit(1)
        .maybeSingle();

      if (fallback) {
        return {
          competition_date: fallback.competition_date ?? null,
          start_time: fallback.start_time ?? "19:00",
          end_time: fallback.end_time ?? "23:59",
          pulse_status: (fallback.pulse_status as PulseStatus) ?? "upcoming",
          results_published: Boolean(fallback.results_published),
        };
      }

      return {
        competition_date: null,
        start_time: "19:00",
        end_time: "23:59",
        pulse_status: "upcoming",
        results_published: false,
      };
    }

    return {
      competition_date: data.competition_date ?? null,
      start_time: data.start_time ?? "19:00",
      end_time: data.end_time ?? "23:59",
      pulse_status: (data.pulse_status as PulseStatus) ?? "upcoming",
      results_published: Boolean(data.results_published),
    };
  } catch (err) {
    console.error("[pulse-service] getPulseSettings error:", err);
    return {
      competition_date: null,
      start_time: "19:00",
      end_time: "23:59",
      pulse_status: "upcoming",
      results_published: false,
    };
  }
}

/**
 * Helper to execute UPDATE on pulse_settings id = 1
 * Strips 'id' field and prevents any INSERT/UPSERT.
 */
async function updatePulseSettingsRow(payload: Partial<PulseSettings>): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanPayload: Record<string, any> = { ...payload };
    delete cleanPayload.id;

    // First attempt UPDATE on id = 1
    const { error, count } = await (supabase as any)
      .from("pulse_settings")
      .update(cleanPayload, { count: "exact" })
      .eq("id", 1);

    if (error) {
      console.error("[pulse-service] update error on id=1:", error);
      return { success: false, error: error.message };
    }

    // If 0 rows were updated, find the single record and update by its actual id
    if (count === 0) {
      const { data: existing } = await (supabase as any)
        .from("pulse_settings")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existing?.id !== undefined && existing?.id !== null) {
        const { error: retryErr } = await (supabase as any)
          .from("pulse_settings")
          .update(cleanPayload)
          .eq("id", existing.id);

        if (retryErr) {
          return { success: false, error: retryErr.message };
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("[pulse-service] update exception:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Save schedule: competition_date, start_time, end_time
 */
export async function saveSchedule(params: {
  competition_date: string | null;
  start_time: string | null;
  end_time: string | null;
}): Promise<{ success: boolean; error?: string }> {
  return updatePulseSettingsRow({
    competition_date: params.competition_date ? params.competition_date.split("T")[0] : null,
    start_time: params.start_time ? params.start_time.trim().slice(0, 8) : null,
    end_time: params.end_time ? params.end_time.trim().slice(0, 8) : null,
  });
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
            competition_date: row.competition_date ?? null,
            start_time: row.start_time ?? "19:00",
            end_time: row.end_time ?? "23:59",
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
 * Ranking order:
 * 1) Highest score (score DESC)
 * 2) Lowest completion time (time_taken_seconds ASC)
 * 3) Earliest submission (completed_at ASC)
 */
export async function fetchPulseLeaderboard(
  currentUserEmail?: string | null,
  limit = 50
): Promise<PulseAttemptLeaderboardEntry[]> {
  try {
    const { data: attempts, error } = await (supabase as any)
      .from("championship_pulse_attempts")
      .select("*")
      .order("score", { ascending: false })
      .order("time_taken_seconds", { ascending: true })
      .order("completed_at", { ascending: true })
      .limit(limit);

    if (error || !attempts || attempts.length === 0) {
      return [];
    }

    // Enrich with names/colleges from registrations if available
    const emails = attempts.map((a: any) => a.user_email).filter(Boolean);
    const regMap = new Map<string, { name: string; college: string }>();

    if (emails.length > 0) {
      try {
        const { data: regs } = await (supabase as any)
          .from("championship_registrations")
          .select("email, full_name, medical_college")
          .in("email", emails);

        if (regs) {
          for (const r of regs) {
            if (r.email) {
              regMap.set(r.email.toLowerCase(), {
                name: r.full_name,
                college: r.medical_college,
              });
            }
          }
        }
      } catch {
        // ignore registration enrich errors
      }
    }

    // Deduplicate by student identity keeping their best sorted attempt
    const seen = new Set<string>();
    const uniqueAttempts: any[] = [];
    for (const a of attempts) {
      const key = a.user_id || a.user_email || a.id;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueAttempts.push(a);
      }
    }

    return uniqueAttempts.map((row, idx) => {
      const email = (row.user_email || "").toLowerCase();
      const regInfo = email ? regMap.get(email) : null;
      const displayName =
        row.student_name ||
        regInfo?.name ||
        (email ? email.split("@")[0] : `Participant #${idx + 1}`);

      const college = row.college || regInfo?.college || "Medical College";

      const isCurrentUser =
        currentUserEmail && email
          ? email === currentUserEmail.toLowerCase()
          : false;

      return {
        rank: idx + 1,
        id: row.id,
        user_id: row.user_id || row.id,
        student_name: displayName,
        college,
        score: Number(row.score ?? 0),
        accuracy: Number(row.accuracy ?? 0),
        time_taken_seconds: Number(row.time_taken_seconds ?? 0),
        completed_at: row.completed_at || row.created_at || null,
        is_current_user: isCurrentUser,
      };
    });
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
