/**
 * ==============================================================================
 * Module: anti-cheat-admin-service.ts
 * Description:
 *   Production Admin Service for MedTrail Championship Anti-Cheat Dashboard.
 *   Provides real-time telemetry querying, live suspicious-attempt audits,
 *   event timeline inspection, and administrative review transitions.
 *
 * Security & Data Constraints:
 *   - Strictly read-only against exam answers and question data.
 *   - Never modifies score, accuracy, XP, or ranking.
 *   - Reviews execute through the authoritative SECURITY DEFINER RPC:
 *     admin_review_pulse_attempt(UUID, TEXT, TEXT).
 *   - Uses the four authoritative review states:
 *     'unreviewed' | 'flagged' | 'cleared' | 'disqualified'.
 * ==============================================================================
 */

import { supabase } from "@/integrations/supabase/client";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ReviewStatus = "unreviewed" | "flagged" | "cleared" | "disqualified";
export type CompetitionType = "daily_pulse" | "grand_finale";

export interface AntiCheatDashboardStats {
  activeSessionsCount: number;
  activeParticipantsCount: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  flaggedAttemptsCount: number;
  totalEventsCount: number;
  totalAttemptsCount: number;
  lastUpdated: string;
}

export interface SuspiciousAttemptRow {
  id: string;
  competition_type: CompetitionType;
  finale_code: string | null;
  seat_number: number | null;
  device_id: string | null;
  integrity_flags: string[];
  student_name: string;
  user_email: string;
  college: string;
  batch: string;
  pulse_date: string;
  score: number;
  accuracy: number;
  time_taken_seconds: number;
  xp: number;
  session_id: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
  events_count: number;
}

export interface AntiCheatEventDetail {
  id: string;
  session_id: string;
  user_id: string;
  competition_type: CompetitionType;
  finale_code: string | null;
  event_type: string;
  client_timestamp: string | null;
  duration_ms: number | null;
  metadata: Record<string, any>;
  server_timestamp: string;
  severity: "low" | "medium" | "high" | "critical";
  risk_delta: number;
}

export interface PulseSessionDetail {
  id: string;
  competition_type: CompetitionType;
  finale_code: string | null;
  bound_device_id: string | null;
  reconnect_count: number;
  pulse_id: string;
  pulse_date: string;
  user_id: string;
  status: "active" | "submitted" | "expired" | "abandoned";
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  telemetry_events_count: number;
  last_heartbeat_at: string | null;
  metadata: Record<string, any>;
}

export interface AntiCheatFilterOptions {
  search?: string;
  competitionType?: "all" | CompetitionType;
  riskLevel?: "all" | RiskLevel;
  reviewStatus?: "all" | ReviewStatus;
  pulseDate?: string;
  college?: string;
  eventType?: string;
}

/**
 * Authoritative Server-side Heuristic Weights & Thresholds
 * Read-only representation of the database migration parameters in 20261005.
 */
export const ENGINE_RULEBOOK_PARAMETERS = {
  tabHiddenPenalty: 10,
  windowBlurPenalty: 5,
  copyPastePenalty: 15,
  devToolsPenalty: 25,
  heartbeatJitterPenalty: 5,
  fullscreenExitPenalty: 10,
  autoFlagThreshold: 50,
  criticalThreshold: 75,
  sessionTimeoutSeconds: 360,
  maxBatchEvents: 50,
  reviewStates: ["unreviewed", "flagged", "cleared", "disqualified"] as const,
  policyStatus: "LOCKED_DATABASE_AUTHORITATIVE",
};

/**
 * Returns severity classification and risk point contribution for any event type.
 */
export function getEventSeverityAndRiskDelta(eventType: string): {
  severity: "low" | "medium" | "high" | "critical";
  risk_delta: number;
} {
  const norm = eventType?.toUpperCase().trim() || "";
  switch (norm) {
    case "DEVTOOLS_OPENED":
    case "SCRIPT_INJECTION":
    case "EXTENSION_TAMPERING":
    case "DEBUGGER_HALTED":
      return { severity: "critical", risk_delta: 25 };
    case "COPY_ATTEMPT":
    case "PASTE_ATTEMPT":
    case "DEVICE_MISMATCH_BLOCKED":
      return { severity: "high", risk_delta: 15 };
    case "TAB_HIDDEN":
    case "FULLSCREEN_EXIT":
    case "TAB_SWITCH":
      return { severity: "medium", risk_delta: 10 };
    case "WINDOW_BLUR":
    case "PAGE_HIDDEN":
    case "HEARTBEAT_JITTER":
    case "LATE_SUBMISSION_REJECTED":
      return { severity: "low", risk_delta: 5 };
    default:
      return { severity: "low", risk_delta: 0 };
  }
}

/**
 * Fetches real-time telemetry metrics across sessions, events, and attempts.
 */
export async function fetchAntiCheatStats(): Promise<AntiCheatDashboardStats> {
  const now = new Date();

  try {
    // 1. Fetch active monitored sessions (Daily Pulse + Official Grand Finale, excluding is_test)
    const [pulseActiveRes, finaleActiveRes, eventsCountRes, pulseAttemptsRes, finaleAttemptsRes] =
      await Promise.all([
        supabase
          .from("championship_pulse_sessions")
          .select("id, user_id, risk_score, risk_level, status", { count: "exact" })
          .eq("status", "active")
          .gt("expires_at", now.toISOString()),
        (supabase as any)
          .from("championship_finale_sessions")
          .select("id, user_id, risk_score, risk_level, status", { count: "exact" })
          .eq("is_test", false)
          .eq("status", "active")
          .gt("expires_at", now.toISOString()),
        (supabase as any)
          .from("championship_anti_cheat_events")
          .select("*", { count: "exact", head: true })
          .eq("is_test", false),
        supabase
          .from("championship_pulse_attempts")
          .select("id, risk_score, risk_level, review_status"),
        (supabase as any)
          .from("championship_finale_attempts")
          .select("id, risk_score, risk_level, review_status")
          .eq("is_test", false),
      ]);

    const activeSessions = [
      ...(pulseActiveRes.data || []),
      ...(finaleActiveRes.data || []),
    ];
    const activeSessionsCount =
      (pulseActiveRes.count || 0) + (finaleActiveRes.count || 0);

    const activeParticipants = new Set(
      activeSessions.map((s: any) => s.user_id).filter(Boolean)
    ).size;

    const totalEventsCount = eventsCountRes.count || 0;

    // Combine official Daily Pulse & Grand Finale attempt metrics cleanly
    const attempts = [
      ...(pulseAttemptsRes.data || []),
      ...(finaleAttemptsRes.data || []),
    ];

    let lowRiskCount = 0;
    let mediumRiskCount = 0;
    let highRiskCount = 0;
    let criticalRiskCount = 0;
    let flaggedAttemptsCount = 0;

    (attempts || []).forEach((att: any) => {
      const score = Number(att.risk_score || 0);
      const level = (att.risk_level || "").toLowerCase();

      if (level === "critical" || score >= 75) {
        criticalRiskCount++;
      } else if (level === "high" || score >= 50) {
        highRiskCount++;
      } else if (level === "medium" || score >= 25) {
        mediumRiskCount++;
      } else {
        lowRiskCount++;
      }

      if (att.review_status === "flagged") {
        flaggedAttemptsCount++;
      }
    });

    return {
      activeSessionsCount: activeSessionsCount || 0,
      activeParticipantsCount: activeParticipants,
      lowRiskCount,
      mediumRiskCount,
      highRiskCount,
      criticalRiskCount,
      flaggedAttemptsCount,
      totalEventsCount: totalEventsCount || 0,
      totalAttemptsCount: attempts?.length || 0,
      lastUpdated: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  } catch (err) {
    console.error("[AntiCheatAdminService] Error fetching stats:", err);
    return {
      activeSessionsCount: 0,
      activeParticipantsCount: 0,
      lowRiskCount: 0,
      mediumRiskCount: 0,
      highRiskCount: 0,
      criticalRiskCount: 0,
      flaggedAttemptsCount: 0,
      totalEventsCount: 0,
      totalAttemptsCount: 0,
      lastUpdated: now.toLocaleTimeString(),
    };
  }
}

/**
 * Fetches attempts along with their telemetry summary.
 */
export async function fetchAttemptsWithTelemetry(
  filters?: AntiCheatFilterOptions
): Promise<SuspiciousAttemptRow[]> {
  try {
    const includePulse = !filters?.competitionType || filters.competitionType === "all" || filters.competitionType === "daily_pulse";
    const includeFinale = !filters?.competitionType || filters.competitionType === "all" || filters.competitionType === "grand_finale";

    let pulseRowsRaw: any[] = [];
    let finaleRowsRaw: any[] = [];
    const rosterEmailsBySeat: Record<number, string> = {};

    if (includePulse) {
      let query = supabase
        .from("championship_pulse_attempts")
        .select(
          "id, student_name, user_email, college, batch, pulse_date, score, accuracy, time_taken_seconds, xp, session_id, risk_score, risk_level, review_status, reviewed_by, reviewed_at, admin_notes, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters?.pulseDate && filters.pulseDate !== "all") {
        query = query.eq("pulse_date", filters.pulseDate);
      }
      if (filters?.college && filters.college !== "all") {
        query = query.eq("college", filters.college);
      }
      if (filters?.reviewStatus && filters.reviewStatus !== "all") {
        query = query.eq("review_status", filters.reviewStatus);
      }

      const { data, error } = await query;
      if (error) {
        console.error("[AntiCheatAdminService] Error fetching pulse attempts:", error);
      } else {
        pulseRowsRaw = data || [];
      }
    }

    if (includeFinale) {
      let fQuery = (supabase as any)
        .from("championship_finale_attempts")
        .select(
          "id, session_id, finale_code, user_id, seat_number, student_name, college, batch, score, accuracy, elapsed_seconds, is_test, device_id, risk_score, risk_level, integrity_flags, review_status, reviewed_by, reviewed_at, admin_notes, submitted_at"
        )
        .eq("is_test", false)
        .order("submitted_at", { ascending: false })
        .limit(200);

      if (filters?.pulseDate && filters.pulseDate !== "all") {
        fQuery = fQuery.eq("finale_code", filters.pulseDate);
      }
      if (filters?.college && filters.college !== "all") {
        fQuery = fQuery.eq("college", filters.college);
      }
      if (filters?.reviewStatus && filters.reviewStatus !== "all") {
        fQuery = fQuery.eq("review_status", filters.reviewStatus);
      }

      const [fRes, rRes] = await Promise.all([
        fQuery,
        (supabase as any)
          .from("championship_finale_approved_roster")
          .select("seat_number, email"),
      ]);

      if (fRes.error) {
        console.warn("[AntiCheatAdminService] Finale attempts fetch note:", fRes.error.message);
      } else {
        finaleRowsRaw = fRes.data || [];
      }

      if (!rRes.error && Array.isArray(rRes.data)) {
        rRes.data.forEach((r: any) => {
          if (typeof r.seat_number === "number" && r.email) {
            rosterEmailsBySeat[r.seat_number] = String(r.email);
          }
        });
      }
    }

    // Collect session IDs across both competitions to batch-query unified anti-cheat events
    const sessionIds = [
      ...pulseRowsRaw.map((row: any) => row.session_id),
      ...finaleRowsRaw.map((row: any) => row.session_id),
    ].filter((id: any): id is string => Boolean(id));

    const eventCountsMap: Record<string, number> = {};

    if (sessionIds.length > 0) {
      try {
        const { data: eventRows } = await (supabase as any)
          .from("championship_anti_cheat_events")
          .select("session_id")
          .eq("is_test", false)
          .in("session_id", sessionIds);

        (eventRows || []).forEach((ev: any) => {
          if (ev.session_id) {
            eventCountsMap[ev.session_id] = (eventCountsMap[ev.session_id] || 0) + 1;
          }
        });
      } catch (e) {
        console.warn("[AntiCheatAdminService] Could not aggregate event counts:", e);
      }
    }

    const computeLevel = (score: number, existing?: string | null): RiskLevel => {
      if (existing === "low" || existing === "medium" || existing === "high" || existing === "critical") {
        return existing;
      }
      if (score >= 75) return "critical";
      if (score >= 50) return "high";
      if (score >= 25) return "medium";
      return "low";
    };

    const pulseRows: SuspiciousAttemptRow[] = pulseRowsRaw.map((row: any) => {
      const riskScore = Number(row.risk_score || 0);
      return {
        id: row.id,
        competition_type: "daily_pulse",
        finale_code: null,
        seat_number: null,
        device_id: null,
        integrity_flags: [],
        student_name: row.student_name || "Anonymous Student",
        user_email: row.user_email || "N/A",
        college: row.college || "N/A",
        batch: row.batch || "N/A",
        pulse_date: row.pulse_date || "",
        score: Number(row.score || 0),
        accuracy: Number(row.accuracy || 0),
        time_taken_seconds: Number(row.time_taken_seconds || 0),
        xp: Number(row.xp || 0),
        session_id: row.session_id || null,
        risk_score: riskScore,
        risk_level: computeLevel(riskScore, row.risk_level),
        review_status: (row.review_status as ReviewStatus) || "unreviewed",
        reviewed_by: row.reviewed_by || null,
        reviewed_at: row.reviewed_at || null,
        admin_notes: row.admin_notes || null,
        created_at: row.created_at || "",
        events_count: row.session_id ? (eventCountsMap[row.session_id] || 0) : 0,
      };
    });

    const finaleRows: SuspiciousAttemptRow[] = finaleRowsRaw.map((row: any) => {
      const riskScore = Number(row.risk_score || 0);
      const seatNum = Number(row.seat_number || 0);
      const code = String(row.finale_code || "FINALE");
      return {
        id: row.id,
        competition_type: "grand_finale",
        finale_code: code,
        seat_number: seatNum,
        device_id: row.device_id ? String(row.device_id) : null,
        integrity_flags: Array.isArray(row.integrity_flags) ? row.integrity_flags.map(String) : [],
        student_name: row.student_name || `Seat #${seatNum}`,
        user_email: rosterEmailsBySeat[seatNum] || `Seat #${seatNum}`,
        college: row.college || "N/A",
        batch: row.batch || "N/A",
        pulse_date: code,
        score: Number(row.score || 0),
        accuracy: Number(row.accuracy || 0),
        time_taken_seconds: Number(row.elapsed_seconds || 0),
        xp: 0,
        session_id: row.session_id || null,
        risk_score: riskScore,
        risk_level: computeLevel(riskScore, row.risk_level),
        review_status: (row.review_status as ReviewStatus) || "unreviewed",
        reviewed_by: row.reviewed_by || null,
        reviewed_at: row.reviewed_at || null,
        admin_notes: row.admin_notes || null,
        created_at: row.submitted_at || "",
        events_count: row.session_id ? (eventCountsMap[row.session_id] || 0) : 0,
      };
    });

    const rows: SuspiciousAttemptRow[] = [...finaleRows, ...pulseRows].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );

    return rows.filter((r) => {
      if (filters?.riskLevel && filters.riskLevel !== "all") {
        if (r.risk_level !== filters.riskLevel) return false;
      }

      if (filters?.search) {
        const q = filters.search.toLowerCase().trim();
        const matchesName = r.student_name.toLowerCase().includes(q);
        const matchesEmail = r.user_email.toLowerCase().includes(q);
        const matchesCollege = r.college.toLowerCase().includes(q);
        const matchesFinale = (r.finale_code || "").toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesCollege && !matchesFinale) return false;
      }

      return true;
    });
  } catch (err) {
    console.error("[AntiCheatAdminService] Error in fetchAttemptsWithTelemetry:", err);
    return [];
  }
}

/**
 * Fetches the complete chronological telemetry event timeline for a given session.
 */
export async function fetchAttemptTelemetryTimeline(
  sessionId: string
): Promise<AntiCheatEventDetail[]> {
  if (!sessionId) return [];

  try {
    const { data, error } = await (supabase as any)
      .from("championship_anti_cheat_events")
      .select("id, session_id, user_id, competition_type, finale_code, event_type, client_timestamp, duration_ms, metadata, server_timestamp")
      .eq("session_id", sessionId)
      .order("server_timestamp", { ascending: true });

    if (error) {
      console.error("[AntiCheatAdminService] Error fetching event timeline:", error);
      return [];
    }

    return (data || []).map((e: any) => {
      const { severity, risk_delta } = getEventSeverityAndRiskDelta(e.event_type);
      return {
        id: e.id,
        session_id: e.session_id,
        user_id: e.user_id,
        competition_type: (e.competition_type === "grand_finale" ? "grand_finale" : "daily_pulse") as CompetitionType,
        finale_code: e.finale_code || null,
        event_type: e.event_type || "UNKNOWN",
        client_timestamp: e.client_timestamp || null,
        duration_ms: e.duration_ms ? Number(e.duration_ms) : null,
        metadata: e.metadata || {},
        server_timestamp: e.server_timestamp,
        severity,
        risk_delta,
      };
    });
  } catch (err) {
    console.error("[AntiCheatAdminService] Exception fetching event timeline:", err);
    return [];
  }
}

/**
 * Fetches detailed session information (Daily Pulse or Grand Finale).
 */
export async function fetchSessionDetails(
  sessionId: string,
  competitionType?: CompetitionType
): Promise<PulseSessionDetail | null> {
  if (!sessionId) return null;

  try {
    if (competitionType !== "grand_finale") {
      const { data, error } = await (supabase as any)
        .from("championship_pulse_sessions")
        .select("id, pulse_id, pulse_date, user_id, status, started_at, expires_at, submitted_at, risk_score, risk_level, telemetry_events_count, last_heartbeat_at, metadata")
        .eq("id", sessionId)
        .maybeSingle();

      if (!error && data) {
        const row = data as any;
        return {
          id: row.id,
          competition_type: "daily_pulse",
          finale_code: null,
          bound_device_id: null,
          reconnect_count: 0,
          pulse_id: row.pulse_id,
          pulse_date: String(row.pulse_date),
          user_id: row.user_id,
          status: row.status,
          started_at: row.started_at,
          expires_at: row.expires_at,
          submitted_at: row.submitted_at || null,
          risk_score: Number(row.risk_score || 0),
          risk_level: (row.risk_level as RiskLevel) || "low",
          telemetry_events_count: Number(row.telemetry_events_count || 0),
          last_heartbeat_at: row.last_heartbeat_at || null,
          metadata: row.metadata || {},
        };
      }
    }

    const { data: fData, error: fErr } = await (supabase as any)
      .from("championship_finale_sessions")
      .select("id, finale_code, user_id, status, started_at, expires_at, submitted_at, bound_device_id, reconnect_count, risk_score, risk_level, telemetry_events_count, last_heartbeat_at, metadata")
      .eq("id", sessionId)
      .maybeSingle();

    if (fErr || !fData) return null;
    const fRow = fData as any;
    return {
      id: fRow.id,
      competition_type: "grand_finale",
      finale_code: String(fRow.finale_code || ""),
      bound_device_id: fRow.bound_device_id || null,
      reconnect_count: Number(fRow.reconnect_count || 0),
      pulse_id: String(fRow.finale_code || ""),
      pulse_date: String(fRow.finale_code || ""),
      user_id: fRow.user_id,
      status: fRow.status,
      started_at: fRow.started_at,
      expires_at: fRow.expires_at,
      submitted_at: fRow.submitted_at || null,
      risk_score: Number(fRow.risk_score || 0),
      risk_level: (fRow.risk_level as RiskLevel) || "low",
      telemetry_events_count: Number(fRow.telemetry_events_count || 0),
      last_heartbeat_at: fRow.last_heartbeat_at || null,
      metadata: fRow.metadata || {},
    };
  } catch {
    return null;
  }
}

/**
 * Submits an administrative review action for a pulse attempt.
 * Invokes the authoritative RPC: admin_review_pulse_attempt(UUID, TEXT, TEXT).
 */
export async function submitAttemptReview(
  attemptId: string,
  reviewStatus: ReviewStatus,
  adminNotes?: string
): Promise<{ success: boolean; error?: string }> {
  if (!attemptId) {
    return { success: false, error: "Attempt ID is required." };
  }

  if (!["unreviewed", "flagged", "cleared", "disqualified"].includes(reviewStatus)) {
    return { success: false, error: "Invalid review status. Allowed: unreviewed, flagged, cleared, disqualified." };
  }

  try {
    const { data, error } = await (supabase as any).rpc("admin_review_pulse_attempt", {
      p_attempt_id: attemptId,
      p_review_status: reviewStatus,
      p_admin_notes: adminNotes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data && data.success === false) {
      return { success: false, error: data.error || "Review operation failed." };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[AntiCheatAdminService] Review submission exception:", err);
    return { success: false, error: err.message || "Failed to submit review." };
  }
}
