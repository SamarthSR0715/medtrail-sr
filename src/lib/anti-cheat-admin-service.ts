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
      return { severity: "critical", risk_delta: 25 };
    case "COPY_ATTEMPT":
    case "PASTE_ATTEMPT":
      return { severity: "high", risk_delta: 15 };
    case "TAB_HIDDEN":
    case "FULLSCREEN_EXIT":
    case "TAB_SWITCH":
      return { severity: "medium", risk_delta: 10 };
    case "WINDOW_BLUR":
    case "PAGE_HIDDEN":
    case "HEARTBEAT_JITTER":
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
    // 1. Fetch active monitored sessions
    const { data: activeSessions, count: activeSessionsCount } = await supabase
      .from("championship_pulse_sessions")
      .select("id, user_id, risk_score, risk_level, status", { count: "exact" })
      .eq("status", "active")
      .gt("expires_at", now.toISOString());

    const activeParticipants = new Set(
      (activeSessions || []).map((s: any) => s.user_id).filter(Boolean)
    ).size;

    // 2. Fetch total anti-cheat events count
    const { count: totalEventsCount } = await supabase
      .from("championship_anti_cheat_events")
      .select("*", { count: "exact", head: true });

    // 3. Fetch attempts risk & review distribution
    const { data: attempts } = await supabase
      .from("championship_pulse_attempts")
      .select("id, risk_score, risk_level, review_status");

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
      console.error("[AntiCheatAdminService] Error fetching attempts:", error);
      return [];
    }

    // Collect session IDs to batch-query event counts
    const sessionIds = (data || [])
      .map((row: any) => row.session_id)
      .filter((id: any): id is string => Boolean(id));

    const eventCountsMap: Record<string, number> = {};

    if (sessionIds.length > 0) {
      try {
        const { data: eventRows } = await supabase
          .from("championship_anti_cheat_events")
          .select("session_id")
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

    const rows: SuspiciousAttemptRow[] = (data || []).map((row: any) => {
      const riskScore = Number(row.risk_score || 0);
      let riskLevel: RiskLevel = (row.risk_level as RiskLevel) || "low";
      if (!row.risk_level) {
        if (riskScore >= 75) riskLevel = "critical";
        else if (riskScore >= 50) riskLevel = "high";
        else if (riskScore >= 25) riskLevel = "medium";
        else riskLevel = "low";
      }

      const eventsCount = row.session_id ? (eventCountsMap[row.session_id] || 0) : 0;

      return {
        id: row.id,
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
        risk_level: riskLevel,
        review_status: (row.review_status as ReviewStatus) || "unreviewed",
        reviewed_by: row.reviewed_by || null,
        reviewed_at: row.reviewed_at || null,
        admin_notes: row.admin_notes || null,
        created_at: row.created_at || "",
        events_count: eventsCount,
      };
    });

    // Apply client-side filters for risk level and search
    return rows.filter((r) => {
      if (filters?.riskLevel && filters.riskLevel !== "all") {
        if (r.risk_level !== filters.riskLevel) return false;
      }

      if (filters?.search) {
        const q = filters.search.toLowerCase().trim();
        const matchesName = r.student_name.toLowerCase().includes(q);
        const matchesEmail = r.user_email.toLowerCase().includes(q);
        const matchesCollege = r.college.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesCollege) return false;
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
    const { data, error } = await supabase
      .from("championship_anti_cheat_events")
      .select("id, session_id, user_id, event_type, client_timestamp, duration_ms, metadata, server_timestamp")
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
 * Fetches detailed session information.
 */
export async function fetchSessionDetails(
  sessionId: string
): Promise<PulseSessionDetail | null> {
  if (!sessionId) return null;

  try {
    const { data, error } = await (supabase as any)
      .from("championship_pulse_sessions")
      .select("id, pulse_id, pulse_date, user_id, status, started_at, expires_at, submitted_at, risk_score, risk_level, telemetry_events_count, last_heartbeat_at, metadata")
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as any;
    return {
      id: row.id,
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
