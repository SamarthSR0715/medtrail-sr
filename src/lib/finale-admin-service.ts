/**
 * MedTrail Championship Season 1 Grand Finale — Administrative TypeScript Service
 * Authoritative client service for Grand Finale operations, day management,
 * dual-admin approvals, contestant monitoring, and results reconciliation.
 *
 * Security Principles Enforced:
 * - Direct mutations are blocked by SQL RLS policies.
 * - All high-stakes actions use server-authoritative SECURITY DEFINER RPCs.
 * - Dual-admin approvals enforce initiator/executor separation and prospective hash binding.
 * - Realtime subscriptions attach only to authorized tables with proper channel cleanup.
 */

import { supabase } from "@/integrations/supabase/client";

// ==============================================================================
// 1. TYPE DEFINITIONS & INTERFACES (Aligned with 20261118000001-3 migrations)
// ==============================================================================

export type FinaleEventStatus = "draft" | "scheduled" | "live" | "completed" | "cancelled";

export interface FinaleEvent {
  id: string; // 'SEASON_1'
  title: string;
  season_id: string; // 'S1'
  status: FinaleEventStatus;
  total_days: number; // 3
  questions_per_day: number; // 10
  session_time_limit_seconds: number; // 90.000
  points_per_correct: number; // 100
  created_at: string;
  updated_at: string;
}

export type FinaleDayStatus =
  | "draft"
  | "scheduled"
  | "open"
  | "paused"
  | "closed"
  | "results_published";

export interface FinaleDay {
  day_number: number; // 1, 2, 3
  event_id: string;
  competition_date: string; // YYYY-MM-DD
  window_opens_at: string;
  window_closes_at: string;
  status: FinaleDayStatus;
  paused_at: string | null;
  results_published: boolean;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FinaleSeatType = "finalist" | "reserve";
export type FinaleVerificationStatus = "pending" | "verified" | "rejected";
export type FinaleParticipationStatus = "active" | "withdrawn" | "disqualified" | "promoted";

export interface FinaleRosterSeat {
  id: string;
  seat_type: FinaleSeatType;
  seat_number: number; // finalist 1..10, reserve 1..2
  user_id: string;
  qualifier_id: string;
  student_name: string;
  college: string;
  batch: string;
  qualification_rank: number;
  verification_status: FinaleVerificationStatus;
  attendance_confirmed: boolean;
  participation_status: FinaleParticipationStatus;
  promoted_to_seat: number | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinaleRosterMeta {
  id: number; // 1
  is_sealed: boolean;
  sealed_at: string | null;
  sealed_by: string | null;
  roster_hash: string | null;
  questions_hash: string | null;
  total_finalists_count: number;
  total_reserves_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type FinaleQuestionOption = "A" | "B" | "C" | "D";

export interface FinaleQuestion {
  id: string;
  day_number: number; // 1..3
  slot_number: number; // 1..10
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: FinaleQuestionOption;
  explanation: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export type FinaleSessionStatus = "active" | "completed" | "expired" | "voided";

export interface FinaleSession {
  id: string;
  day_number: number;
  roster_id: string;
  user_id: string;
  status: FinaleSessionStatus;
  current_slot: number;
  started_at: string;
  expires_at: string;
  completed_at: string | null;
  total_time_seconds: number;
  total_score: number;
  correct_count: number;
  attempted_count: number;
  skipped_count: number;
  unanswered_count: number;
  is_reissued: boolean;
  reissue_count: number;
  reissue_reason: string | null;
  reissued_from_session_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  client_ip_hash: string | null;
  client_user_agent: string | null;
  created_at: string;
  updated_at: string;
  // Joined or augmented fields
  student_name?: string;
  college?: string;
  seat_number?: number;
}

export type FinaleSlotState = "pending" | "answered" | "skipped" | "timeout" | "unanswered";

export interface FinaleQuestionState {
  id: string;
  session_id: string;
  day_number: number;
  user_id: string;
  question_id: string;
  slot_number: number;
  state: FinaleSlotState;
  selected_option: FinaleQuestionOption | null;
  is_correct: boolean;
  points_awarded: number; // 0 or 100
  elapsed_slot_seconds: number;
  idempotency_key: string;
  client_timestamp: string | null;
  server_received_at: string;
  created_at: string;
}

export interface FinaleAttempt {
  id: string;
  session_id: string;
  day_number: number;
  user_id: string;
  slot_number: number;
  action_type: "answer" | "skip" | "timeout" | "auto_close";
  payload: Record<string, any>;
  client_timestamp: string;
  server_received_at: string;
  idempotency_key: string;
  was_accepted: boolean;
  rejection_reason: string | null;
  created_at: string;
}

export type FinaleResultType = "daily" | "cumulative";
export type FinaleTieStatus = "none" | "resolved_by_rules" | "joint_standing" | "sudden_death_scheduled";

export interface FinaleResult {
  id: string;
  result_type: FinaleResultType;
  day_number: number | null;
  roster_id: string;
  user_id: string;
  student_name: string;
  college: string;
  batch: string;
  seat_number: number;
  score: number;
  elapsed_time_seconds: number;
  correct_count: number;
  attempted_count: number;
  skipped_count: number;
  unanswered_count: number;
  day1_score: number | null;
  day1_time_seconds: number | null;
  day2_score: number | null;
  day2_time_seconds: number | null;
  day3_score: number | null;
  day3_time_seconds: number | null;
  rank: number;
  is_winner: boolean;
  tie_status: FinaleTieStatus;
  published_at: string;
  published_by: string;
  snapshot_version: number;
}

export type FinaleApprovalAction =
  | "SEAL_ROSTER"
  | "PROMOTE_RESERVE"
  | "VOID_AND_REISSUE_SESSION"
  | "PUBLISH_DAILY_RESULTS"
  | "DECLARE_FINAL_WINNER";

export type FinaleApprovalStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected"
  | "expired";

export interface FinaleAdminApproval {
  id: string;
  action_name: FinaleApprovalAction;
  target_day: number | null;
  payload_hash: string;
  payload: Record<string, any>;
  first_approver_id: string;
  first_approved_at: string;
  confirmation_phrase: string;
  second_approver_id: string | null;
  second_approved_at: string | null;
  status: FinaleApprovalStatus;
  expires_at: string;
  executed_at: string | null;
}

export type FinaleActorRole = "admin" | "super_admin" | "participant" | "system";

export interface FinaleAuditLogEntry {
  id: string;
  occurred_at: string;
  event_type: string;
  actor_id: string | null;
  actor_role: FinaleActorRole;
  target_entity: string;
  target_id: string | null;
  details: Record<string, any>;
  previous_hash: string;
  current_hash: string;
}

export type FinaleTelemetryEventType = "window_blur" | "visibility_hidden" | "heartbeat" | "reconnect";

export interface FinaleTelemetryEntry {
  id: string;
  session_id: string;
  user_id: string;
  event_type: FinaleTelemetryEventType;
  client_timestamp: string;
  server_timestamp: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface FinaleReconciliationDiscrepancy {
  session_id: string;
  user_id: string;
  cached_score: number;
  calculated_score: number;
  verified_score: number;
  discrepancy_types: string[];
}

export interface FinaleReconciliationResult {
  ok: boolean;
  day_number: number;
  discrepancies: FinaleReconciliationDiscrepancy[];
  total_sessions: number;
  clean_sessions: number;
  error_code?: string;
  message?: string;
}

export interface FinaleLiveOpsSummary {
  event: FinaleEvent | null;
  days: FinaleDay[];
  rosterMeta: FinaleRosterMeta | null;
  finalistsCount: number;
  reservesCount: number;
  activeSessionsCount: number;
  pendingApprovalsCount: number;
  publishedDaysCount: number;
  lastAuditOccurredAt: string | null;
}

export interface FinaleServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

// ==============================================================================
// 2. READ HELPERS (Protected by RLS)
// ==============================================================================

/**
 * Fetch the singleton Finale event configuration.
 */
export async function fetchFinaleEventConfig(): Promise<FinaleServiceResponse<FinaleEvent>> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_finale_event")
      .select("*")
      .eq("id", "SEASON_1")
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: data as FinaleEvent };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale event config" };
  }
}

/**
 * Fetch all 3 Grand Finale competition days, ordered by day_number ascending.
 */
export async function fetchFinaleDays(): Promise<FinaleServiceResponse<FinaleDay[]>> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_finale_days")
      .select("*")
      .order("day_number", { ascending: true });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleDay[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale days" };
  }
}

/**
 * Fetch the complete Grand Finale roster (10 finalists + 2 reserves).
 * Ordered by seat_type ('finalist' first) and seat_number.
 */
export async function fetchFinaleRoster(): Promise<FinaleServiceResponse<FinaleRosterSeat[]>> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_finale_roster")
      .select("*")
      .order("seat_type", { ascending: true })
      .order("seat_number", { ascending: true });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleRosterSeat[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale roster" };
  }
}

/**
 * Fetch the singleton roster metadata and sealing lock record.
 */
export async function fetchFinaleRosterMeta(): Promise<FinaleServiceResponse<FinaleRosterMeta>> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_finale_roster_meta")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: data as FinaleRosterMeta };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale roster meta" };
  }
}

/**
 * Fetch questions from the master question bank.
 * Note: RLS allows admin access via public.is_grand_finale_admin().
 */
export async function fetchFinaleQuestions(dayNumber?: number): Promise<FinaleServiceResponse<FinaleQuestion[]>> {
  try {
    let query = (supabase as any)
      .from("championship_finale_questions")
      .select("*")
      .order("day_number", { ascending: true })
      .order("slot_number", { ascending: true });

    if (dayNumber !== undefined && dayNumber !== null) {
      query = query.eq("day_number", dayNumber);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleQuestion[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale questions" };
  }
}

/**
 * Fetch contestant examination sessions for monitoring.
 */
export async function fetchFinaleSessions(dayNumber?: number): Promise<FinaleServiceResponse<FinaleSession[]>> {
  try {
    let query = (supabase as any)
      .from("championship_finale_sessions")
      .select("*, championship_finale_roster!roster_id(student_name, college, seat_number)")
      .order("started_at", { ascending: false });

    if (dayNumber !== undefined && dayNumber !== null) {
      query = query.eq("day_number", dayNumber);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    const formatted: FinaleSession[] = (data || []).map((row: any) => ({
      ...row,
      student_name: row.championship_finale_roster?.student_name,
      college: row.championship_finale_roster?.college,
      seat_number: row.championship_finale_roster?.seat_number,
    }));

    return { success: true, data: formatted };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale sessions" };
  }
}

/**
 * Fetch detailed inspection data for an individual examination session.
 */
export async function fetchFinaleSessionDetail(sessionId: string): Promise<
  FinaleServiceResponse<{
    session: FinaleSession;
    states: FinaleQuestionState[];
    attempts: FinaleAttempt[];
    telemetry: FinaleTelemetryEntry[];
  }>
> {
  try {
    const [sessRes, statesRes, attemptsRes, teleRes] = await Promise.all([
      (supabase as any)
        .from("championship_finale_sessions")
        .select("*, championship_finale_roster!roster_id(student_name, college, seat_number)")
        .eq("id", sessionId)
        .maybeSingle(),
      (supabase as any)
        .from("championship_finale_question_states")
        .select("*")
        .eq("session_id", sessionId)
        .order("slot_number", { ascending: true }),
      (supabase as any)
        .from("championship_finale_attempts")
        .select("*")
        .eq("session_id", sessionId)
        .order("server_received_at", { ascending: true }),
      (supabase as any)
        .from("championship_finale_telemetry")
        .select("*")
        .eq("session_id", sessionId)
        .order("server_timestamp", { ascending: true }),
    ]);

    if (sessRes.error) return { success: false, error: sessRes.error.message, errorCode: sessRes.error.code };
    if (!sessRes.data) return { success: false, error: "Session not found", errorCode: "SESSION_NOT_FOUND" };

    const session: FinaleSession = {
      ...sessRes.data,
      student_name: sessRes.data.championship_finale_roster?.student_name,
      college: sessRes.data.championship_finale_roster?.college,
      seat_number: sessRes.data.championship_finale_roster?.seat_number,
    };

    return {
      success: true,
      data: {
        session,
        states: (statesRes.data || []) as FinaleQuestionState[],
        attempts: (attemptsRes.data || []) as FinaleAttempt[],
        telemetry: (teleRes.data || []) as FinaleTelemetryEntry[],
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch session detail" };
  }
}

/**
 * Fetch official published standings / results (daily or cumulative).
 */
export async function fetchFinaleResults(
  resultType?: FinaleResultType,
  dayNumber?: number
): Promise<FinaleServiceResponse<FinaleResult[]>> {
  try {
    let query = (supabase as any)
      .from("championship_finale_results")
      .select("*")
      .order("rank", { ascending: true });

    if (resultType) {
      query = query.eq("result_type", resultType);
    }
    if (dayNumber !== undefined && dayNumber !== null) {
      query = query.eq("day_number", dayNumber);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleResult[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch Finale results" };
  }
}

/**
 * Fetch dual administrative approval queue records.
 */
export async function fetchFinaleApprovals(status?: FinaleApprovalStatus): Promise<FinaleServiceResponse<FinaleAdminApproval[]>> {
  try {
    let query = (supabase as any)
      .from("championship_finale_admin_approvals")
      .select("*")
      .order("first_approved_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleAdminApproval[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch approvals" };
  }
}

/**
 * Fetch active pending approvals awaiting secondary authorization.
 */
export async function fetchPendingApprovals(): Promise<FinaleServiceResponse<FinaleAdminApproval[]>> {
  try {
    const nowISO = new Date().toISOString();
    const { data, error } = await (supabase as any)
      .from("championship_finale_admin_approvals")
      .select("*")
      .eq("status", "pending")
      .gt("expires_at", nowISO)
      .order("first_approved_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleAdminApproval[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch pending approvals" };
  }
}

/**
 * Fetch immutable cryptographic audit log records.
 */
export async function fetchFinaleAuditLogs(limit: number = 50): Promise<FinaleServiceResponse<FinaleAuditLogEntry[]>> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_finale_audit_log")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleAuditLogEntry[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch audit log" };
  }
}

/**
 * Fetch ephemeral proctoring telemetry records.
 */
export async function fetchFinaleTelemetry(
  sessionId?: string,
  limit: number = 100
): Promise<FinaleServiceResponse<FinaleTelemetryEntry[]>> {
  try {
    let query = (supabase as any)
      .from("championship_finale_telemetry")
      .select("*")
      .order("server_timestamp", { ascending: false })
      .limit(limit);

    if (sessionId) {
      query = query.eq("session_id", sessionId);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
    return { success: true, data: (data || []) as FinaleTelemetryEntry[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to fetch telemetry" };
  }
}

/**
 * Aggregated live telemetry overview for the Grand Finale Admin Dashboard.
 */
export async function fetchFinaleLiveOpsSummary(): Promise<FinaleServiceResponse<FinaleLiveOpsSummary>> {
  try {
    const [eventRes, daysRes, rosterMetaRes, rosterRes, sessionsRes, approvalsRes, auditRes] =
      await Promise.all([
        fetchFinaleEventConfig(),
        fetchFinaleDays(),
        fetchFinaleRosterMeta(),
        fetchFinaleRoster(),
        fetchFinaleSessions(),
        fetchPendingApprovals(),
        fetchFinaleAuditLogs(1),
      ]);

    const roster = rosterRes.data || [];
    const days = daysRes.data || [];
    const sessions = sessionsRes.data || [];

    const summary: FinaleLiveOpsSummary = {
      event: eventRes.data || null,
      days,
      rosterMeta: rosterMetaRes.data || null,
      finalistsCount: roster.filter((r) => r.seat_type === "finalist").length,
      reservesCount: roster.filter((r) => r.seat_type === "reserve").length,
      activeSessionsCount: sessions.filter((s) => s.status === "active").length,
      pendingApprovalsCount: (approvalsRes.data || []).length,
      publishedDaysCount: days.filter((d) => d.results_published).length,
      lastAuditOccurredAt: auditRes.data?.[0]?.occurred_at || null,
    };

    return { success: true, data: summary };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to compile live ops summary" };
  }
}

// ==============================================================================
// 3. ADMINISTRATIVE DUAL-APPROVAL WORKFLOW (RPC WRAPPERS)
// ==============================================================================

/**
 * Step 1: Admin initiates a dual-approval request.
 * Encapsulates RPC: public.admin_request_approval(p_action_name, p_target_day, p_payload)
 */
export async function adminRequestApproval(
  actionName: FinaleApprovalAction,
  targetDay?: number | null,
  payload: Record<string, any> = {}
): Promise<
  FinaleServiceResponse<{
    approval_id: string;
    action_name: string;
    target_day: number | null;
    payload_hash: string;
    bound_payload: any;
    expires_at: string;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_request_approval", {
      p_action_name: actionName,
      p_target_day: targetDay ?? null,
      p_payload: payload,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Approval request rejected: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
        data,
      };
    }

    return {
      success: true,
      data: {
        approval_id: data.approval_id,
        action_name: data.action_name,
        target_day: data.target_day,
        payload_hash: data.payload_hash,
        bound_payload: data.bound_payload,
        expires_at: data.expires_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to initiate approval request" };
  }
}

/**
 * Rejection: Any administrator may reject/cancel a pending approval.
 * Encapsulates RPC: public.admin_reject_approval(p_approval_id, p_reason)
 */
export async function adminRejectApproval(
  approvalId: string,
  reason: string
): Promise<
  FinaleServiceResponse<{
    approval_id: string;
    status: "rejected";
    rejection_reason: string;
    rejected_at: string;
  }>
> {
  try {
    if (!reason || reason.trim().length < 5) {
      return { success: false, error: "Rejection reason must be at least 5 characters.", errorCode: "DOCUMENTED_REASON_REQUIRED" };
    }

    const { data, error } = await (supabase.rpc as any)("admin_reject_approval", {
      p_approval_id: approvalId,
      p_reason: reason.trim(),
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Rejection failed: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        approval_id: data.approval_id,
        status: "rejected",
        rejection_reason: data.rejection_reason,
        rejected_at: data.rejected_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to reject approval" };
  }
}

// ── Specific Action Initiators ───────────────────────────────────────────────

/**
 * Request dual-approval to SEAL the official roster and question bank.
 * The SQL function automatically pre-validates roster counts and question sets,
 * computing prospective SHA-256 digests bound into the payload.
 */
export async function requestSealRosterApproval(reason: string = "Official sealing of Finalist Roster and 30-Question Bank"): Promise<FinaleServiceResponse<any>> {
  return adminRequestApproval("SEAL_ROSTER", null, { reason });
}

/**
 * Request dual-approval to PROMOTE a reserve contestant into a vacant finalist seat.
 */
export async function requestPromoteReserveApproval(
  reserveSeat: number,
  withdrawingFinalistSeat: number,
  reason: string
): Promise<FinaleServiceResponse<any>> {
  return adminRequestApproval("PROMOTE_RESERVE", null, {
    reserve_seat: reserveSeat,
    withdrawing_finalist_seat: withdrawingFinalistSeat,
    reason: reason.trim(),
  });
}

/**
 * Request dual-approval to VOID and REISSUE an interrupted finalist examination session.
 */
export async function requestVoidAndReissueSessionApproval(
  sessionId: string,
  reason: string
): Promise<FinaleServiceResponse<any>> {
  return adminRequestApproval("VOID_AND_REISSUE_SESSION", null, {
    session_id: sessionId,
    reason: reason.trim(),
  });
}

/**
 * Request dual-approval to PUBLISH official results for a specific finale day.
 */
export async function requestPublishDailyResultsApproval(
  targetDay: number,
  reason: string = `Official publication of Day ${targetDay} results`
): Promise<FinaleServiceResponse<any>> {
  return adminRequestApproval("PUBLISH_DAILY_RESULTS", targetDay, { reason: reason.trim() });
}

/**
 * Request dual-approval to DECLARE the final Grand Finale winner and inscribe the 3-day standing.
 */
export async function requestDeclareFinalWinnerApproval(
  reason: string = "Season 1 Grand Finale Champion Declaration and Hall of Fame Inscription"
): Promise<FinaleServiceResponse<any>> {
  return adminRequestApproval("DECLARE_FINAL_WINNER", null, { reason: reason.trim() });
}

// ── Second-Admin Execution RPC Wrappers ───────────────────────────────────────

/**
 * Execute SEAL_ROSTER approval as the Second Super Administrator.
 * Encapsulates RPC: public.admin_seal_grand_finale_roster(p_approval_id)
 */
export async function executeSealRoster(approvalId: string): Promise<
  FinaleServiceResponse<{
    sealed_at: string;
    roster_hash: string;
    questions_hash: string;
    finalists_count: number;
    reserves_count: number;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_seal_grand_finale_roster", {
      p_approval_id: approvalId,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Failed to seal roster: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        sealed_at: data.sealed_at,
        roster_hash: data.roster_hash,
        questions_hash: data.questions_hash,
        finalists_count: data.finalists_count,
        reserves_count: data.reserves_count,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute roster seal" };
  }
}

/**
 * Execute PROMOTE_RESERVE approval as the Second Super Administrator.
 * Encapsulates RPC: public.admin_promote_reserve(p_approval_id)
 */
export async function executePromoteReserve(approvalId: string): Promise<
  FinaleServiceResponse<{
    promoted_reserve_id: string;
    promoted_to_seat: number;
    withdrawing_finalist_id: string;
    reason: string;
    promoted_at: string;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_promote_reserve", {
      p_approval_id: approvalId,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Failed to promote reserve: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        promoted_reserve_id: data.promoted_reserve_id,
        promoted_to_seat: data.promoted_to_seat,
        withdrawing_finalist_id: data.withdrawing_finalist_id,
        reason: data.reason,
        promoted_at: data.promoted_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute reserve promotion" };
  }
}

/**
 * Execute VOID_AND_REISSUE_SESSION approval as the Second Super Administrator.
 * Encapsulates RPC: public.admin_void_and_reissue_session(p_approval_id)
 */
export async function executeVoidAndReissueSession(approvalId: string): Promise<
  FinaleServiceResponse<{
    voided_session_id: string;
    new_session_id: string;
    day_number: number;
    user_id: string;
    reissued_at: string;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_void_and_reissue_session", {
      p_approval_id: approvalId,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Failed to void and reissue session: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        voided_session_id: data.voided_session_id,
        new_session_id: data.new_session_id,
        day_number: data.day_number,
        user_id: data.user_id,
        reissued_at: data.reissued_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute void and reissue" };
  }
}

/**
 * Execute PUBLISH_DAILY_RESULTS approval as the Second Super Administrator.
 * Encapsulates RPC: public.admin_publish_daily_results(p_approval_id)
 */
export async function executePublishDailyResults(approvalId: string): Promise<
  FinaleServiceResponse<{
    day_number: number;
    results_published: boolean;
    published_at: string;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_publish_daily_results", {
      p_approval_id: approvalId,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Failed to publish daily results: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        day_number: data.day_number,
        results_published: data.results_published,
        published_at: data.published_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute daily results publication" };
  }
}

/**
 * Execute DECLARE_FINAL_WINNER approval as the Second Super Administrator.
 * Encapsulates RPC: public.admin_declare_final_winner(p_approval_id)
 */
export async function executeDeclareFinalWinner(approvalId: string): Promise<
  FinaleServiceResponse<{
    champion_name: string;
    final_score: number;
    declared_at: string;
  }>
> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_declare_final_winner", {
      p_approval_id: approvalId,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Failed to declare final winner: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        champion_name: data.champion_name,
        final_score: data.final_score,
        declared_at: data.declared_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute final winner declaration" };
  }
}

// ==============================================================================
// 4. DIRECT OPERATIONAL ACTIONS (Single Admin RPCs)
// ==============================================================================

/**
 * Fast Emergency Pause / Resume operational toggle for incident intervention.
 * Encapsulates RPC: public.admin_toggle_emergency_pause(p_day_number, p_pause)
 */
export async function toggleEmergencyPause(
  dayNumber: number,
  pause: boolean
): Promise<FinaleServiceResponse<{ status: "paused" | "open" }>> {
  try {
    const { data, error } = await (supabase.rpc as any)("admin_toggle_emergency_pause", {
      p_day_number: dayNumber,
      p_pause: pause,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Emergency toggle failed: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return { success: true, data: { status: data.status } };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to toggle emergency pause" };
  }
}

/**
 * Reconcile Day Examination Scores and verify against the master question bank.
 * Encapsulates RPC: public.reconcile_finale_day_scores(p_day_number)
 */
export async function reconcileFinaleDayScores(
  dayNumber: number
): Promise<FinaleServiceResponse<FinaleReconciliationResult>> {
  try {
    const { data, error } = await (supabase.rpc as any)("reconcile_finale_day_scores", {
      p_day_number: dayNumber,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    if (!data?.ok) {
      return {
        success: false,
        error: data?.message || `Score reconciliation failed: ${data?.error_code || "UNKNOWN"}`,
        errorCode: data?.error_code,
      };
    }

    return {
      success: true,
      data: {
        ok: true,
        day_number: data.day_number,
        discrepancies: data.discrepancies || [],
        total_sessions: data.total_sessions ?? 0,
        clean_sessions: data.clean_sessions ?? 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to reconcile day scores" };
  }
}

/**
 * Maintenance telemetry pruning helper.
 * Encapsulates RPC: public.cleanup_finale_telemetry(p_retention_days)
 */
export async function cleanupFinaleTelemetry(
  retentionDays: number = 30
): Promise<FinaleServiceResponse<{ deleted_count: number }>> {
  try {
    const { data, error } = await (supabase.rpc as any)("cleanup_finale_telemetry", {
      p_retention_days: retentionDays,
    });

    if (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }

    return { success: true, data: { deleted_count: typeof data === "number" ? data : 0 } };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to prune telemetry" };
  }
}

// ==============================================================================
// 5. REALTIME SUBSCRIPTIONS (With Safe Cleanup)
// ==============================================================================

/**
 * Subscribe to realtime day status changes (e.g. status changes, results published).
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToFinaleDays(callback: (day: FinaleDay) => void): () => void {
  const channel = supabase
    .channel("finale_days_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_finale_days" },
      (payload) => {
        if (payload.new) {
          callback(payload.new as FinaleDay);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to dual-approval queue changes (new requests, approvals, rejections).
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToFinaleApprovals(callback: (approval: FinaleAdminApproval) => void): () => void {
  const channel = supabase
    .channel("finale_approvals_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_finale_admin_approvals" },
      (payload) => {
        if (payload.new) {
          callback(payload.new as FinaleAdminApproval);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to live contestant sessions (progress, completions, timeouts).
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToFinaleSessions(callback: (session: FinaleSession) => void): () => void {
  const channel = supabase
    .channel("finale_sessions_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "championship_finale_sessions" },
      (payload) => {
        if (payload.new) {
          callback(payload.new as FinaleSession);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to anti-cheat telemetry stream for active session proctoring.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToFinaleTelemetry(callback: (telemetry: FinaleTelemetryEntry) => void): () => void {
  const channel = supabase
    .channel("finale_telemetry_realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "championship_finale_telemetry" },
      (payload) => {
        if (payload.new) {
          callback(payload.new as FinaleTelemetryEntry);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to immutable audit log stream.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToFinaleAuditLog(callback: (entry: FinaleAuditLogEntry) => void): () => void {
  const channel = supabase
    .channel("finale_audit_realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "championship_finale_audit_log" },
      (payload) => {
        if (payload.new) {
          callback(payload.new as FinaleAuditLogEntry);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

