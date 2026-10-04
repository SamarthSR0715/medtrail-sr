/**
 * Overall Championship Leaderboard Service
 *
 * Admin-only service for cumulative cross-Pulse analytics.
 * All data fetching goes through server-side SECURITY DEFINER RPCs.
 * Students and anonymous callers are rejected at the database level.
 *
 * Scoring definitions:
 *   Total Score  = SUM of individual pulse scores
 *   Avg Score    = total_score / attempts_count
 *   Accuracy     = SUM(answers_correct) / SUM(answers_total) × 100
 *                  (falls back to AVG(accuracy) when raw counts unavailable)
 *   Best Score   = MAX single-pulse score in the selected range
 *   Prev Score   = score of the immediately preceding attempt (by timestamp)
 *   Latest Score = score of the most recent attempt (by timestamp)
 */

import { supabase } from "@/integrations/supabase/client";

// ── Filter Contract ────────────────────────────────────────────────────────────

export type RankingMetric = "total_score" | "avg_score" | "accuracy";

export interface OverallLeaderboardFilters {
  startDate: string | null;        // ISO date string e.g. "2026-09-27"
  endDate: string | null;          // ISO date string e.g. "2026-10-17"
  pulseIds: string[] | null;       // null = all pulses
  collegeFilter: string | null;    // null = all colleges
  batchFilter: string | null;      // null = all batches
  minAttempts: number;             // minimum eligible attempt count
  rankingMetric: RankingMetric;    // which metric drives the rank order
  page: number;                    // 1-based
  pageSize: number;                // rows per page
}

export const DEFAULT_FILTERS: OverallLeaderboardFilters = {
  startDate: null,
  endDate: null,
  pulseIds: null,
  collegeFilter: null,
  batchFilter: null,
  minAttempts: 1,
  rankingMetric: "total_score",
  page: 1,
  pageSize: 50,
};

// ── Data Types ─────────────────────────────────────────────────────────────────

export interface OverallStudentRow {
  rank: number;
  user_id: string;
  student_name: string;
  college: string;
  batch: string;
  attempts_count: number;
  total_score: number;
  avg_score: number;
  best_score: number;
  overall_accuracy: number;
  avg_time_seconds: number;
  total_xp: number;
  latest_score: number | null;
  prev_score: number | null;
  score_change: number | null;
  pct_change: number | null;
  last_attempt_at: string | null;
}

export interface OverallCollegeRow {
  rank: number;
  college: string;
  student_count: number;
  total_attempts: number;
  combined_score: number;
  avg_score: number;
  overall_accuracy: number;
  top_student: string;
}

export interface PulseListItem {
  pulse_id: string;
  pulse_date: string;
  status: string;
  submission_count: number;
}

export interface OverallLeaderboardResult {
  data: OverallStudentRow[];
  total_count: number;
  page: number;
  page_size: number;
  ranking_metric: RankingMetric;
  last_calculated_at: string;
}

export interface OverallCollegeResult {
  data: OverallCollegeRow[];
  last_calculated_at: string;
}

// ── Summary Card Types ─────────────────────────────────────────────────────────

export interface OverallSummaryStats {
  total_students: number;
  total_eligible_attempts: number;
  total_points_scored: number;
  average_score: number;
  overall_accuracy: number;
  highest_ranked_student: string;
  highest_ranked_college: string;
}

// ── Service Functions ──────────────────────────────────────────────────────────

/**
 * Fetch the overall championship leaderboard with the given filters.
 * Admin-only — the RPC enforces this server-side.
 */
export async function fetchOverallLeaderboard(
  filters: OverallLeaderboardFilters
): Promise<OverallLeaderboardResult> {
  const rpcFilters: Record<string, unknown> = {
    ranking_metric: filters.rankingMetric,
    min_attempts: filters.minAttempts,
    page: filters.page,
    page_size: filters.pageSize,
    ...(filters.startDate   ? { start_date:     filters.startDate }   : {}),
    ...(filters.endDate     ? { end_date:       filters.endDate }     : {}),
    ...(filters.pulseIds && filters.pulseIds.length > 0 ? { pulse_ids: filters.pulseIds } : {}),
    ...(filters.collegeFilter ? { college_filter: filters.collegeFilter } : {}),
    ...(filters.batchFilter   ? { batch_filter:   filters.batchFilter }   : {}),
  };

  const { data, error } = await (supabase as any).rpc(
    "get_overall_championship_leaderboard",
    { p_filters: rpcFilters }
  );

  if (error) throw new Error(error.message || "Failed to fetch overall leaderboard");

  if (!data?.ok) {
    throw new Error(data?.error || "Overall leaderboard RPC returned an error");
  }

  return {
    data:               (data.data ?? []) as OverallStudentRow[],
    total_count:        data.total_count ?? 0,
    page:               data.page ?? 1,
    page_size:          data.page_size ?? 50,
    ranking_metric:     (data.ranking_metric ?? "total_score") as RankingMetric,
    last_calculated_at: data.last_calculated_at ?? new Date().toISOString(),
  };
}

/**
 * Fetch overall college standings with the given filters.
 * Admin-only — the RPC enforces this server-side.
 */
export async function fetchOverallCollegeStandings(
  filters: Pick<OverallLeaderboardFilters, "startDate" | "endDate" | "pulseIds" | "batchFilter">
): Promise<OverallCollegeResult> {
  const rpcFilters: Record<string, unknown> = {
    ...(filters.startDate   ? { start_date:   filters.startDate }   : {}),
    ...(filters.endDate     ? { end_date:     filters.endDate }     : {}),
    ...(filters.pulseIds && filters.pulseIds.length > 0 ? { pulse_ids: filters.pulseIds } : {}),
    ...(filters.batchFilter ? { batch_filter: filters.batchFilter } : {}),
  };

  const { data, error } = await (supabase as any).rpc(
    "get_overall_college_standings",
    { p_filters: rpcFilters }
  );

  if (error) throw new Error(error.message || "Failed to fetch college standings");
  if (!data?.ok) throw new Error(data?.error || "College standings RPC returned an error");

  return {
    data:               (data.data ?? []) as OverallCollegeRow[],
    last_calculated_at: data.last_calculated_at ?? new Date().toISOString(),
  };
}

/**
 * Fetch available pulse list for filter dropdowns.
 * Admin-only.
 */
export async function fetchAvailablePulses(): Promise<PulseListItem[]> {
  const { data, error } = await (supabase as any).rpc("get_available_pulse_list");
  if (error) throw new Error(error.message || "Failed to fetch pulse list");
  if (!data?.ok) throw new Error(data?.error || "Pulse list RPC returned an error");
  return (data.data ?? []) as PulseListItem[];
}

/**
 * Compute summary stats from the full current-page result.
 * For accurate totals, these should be computed server-side in a future
 * enhancement; for now they summarize the current fetched page.
 */
export function computeSummaryStats(
  rows: OverallStudentRow[],
  colleges: OverallCollegeRow[]
): OverallSummaryStats {
  if (rows.length === 0) {
    return {
      total_students: 0,
      total_eligible_attempts: 0,
      total_points_scored: 0,
      average_score: 0,
      overall_accuracy: 0,
      highest_ranked_student: "—",
      highest_ranked_college: "—",
    };
  }

  const totalAttempts = rows.reduce((s, r) => s + r.attempts_count, 0);
  const totalScore    = rows.reduce((s, r) => s + r.total_score, 0);
  const avgScore      = rows.reduce((s, r) => s + r.avg_score, 0) / rows.length;
  const avgAccuracy   = rows.reduce((s, r) => s + r.overall_accuracy, 0) / rows.length;

  return {
    total_students:           rows.length,
    total_eligible_attempts:  totalAttempts,
    total_points_scored:      totalScore,
    average_score:            Math.round(avgScore * 10) / 10,
    overall_accuracy:         Math.round(avgAccuracy * 10) / 10,
    highest_ranked_student:   rows[0]?.student_name ?? "—",
    highest_ranked_college:   colleges[0]?.college ?? rows[0]?.college ?? "—",
  };
}

/**
 * Export the current leaderboard rows to CSV.
 * Restricted to authenticated admin sessions in the UI layer.
 */
export function exportOverallLeaderboardToCSV(
  rows: OverallStudentRow[],
  filters: OverallLeaderboardFilters
): void {
  const headers = [
    "Rank",
    "Student Name",
    "College",
    "Batch",
    "Attempts",
    "Total Score",
    "Avg Score",
    "Best Score",
    "Accuracy (%)",
    "Avg Time (s)",
    "Total XP",
    "Latest Score",
    "Prev Score",
    "Score Change",
    "Change (%)",
    "Last Attempt",
  ];

  const csvRows = rows.map((r) => [
    r.rank,
    `"${r.student_name.replace(/"/g, '""')}"`,
    `"${r.college.replace(/"/g, '""')}"`,
    `"${r.batch.replace(/"/g, '""')}"`,
    r.attempts_count,
    r.total_score,
    r.avg_score,
    r.best_score,
    r.overall_accuracy,
    r.avg_time_seconds,
    r.total_xp,
    r.latest_score ?? "",
    r.prev_score ?? "",
    r.score_change ?? "",
    r.pct_change ?? "",
    r.last_attempt_at ? new Date(r.last_attempt_at).toLocaleString("en-IN") : "",
  ]);

  const dateRange = [filters.startDate, filters.endDate].filter(Boolean).join("_to_") || "all_time";
  const filename  = `medtrail_overall_leaderboard_${dateRange}_${new Date().toISOString().slice(0, 10)}.csv`;

  const content = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\r\n");
  const blob    = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url     = URL.createObjectURL(blob);
  const link    = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export college standings to CSV.
 */
export function exportCollegeStandingsToCSV(rows: OverallCollegeRow[]): void {
  const headers = [
    "Rank", "College", "Students", "Total Attempts",
    "Combined Score", "Avg Score", "Accuracy (%)", "Top Student",
  ];
  const csvRows = rows.map((r) => [
    r.rank,
    `"${r.college.replace(/"/g, '""')}"`,
    r.student_count,
    r.total_attempts,
    r.combined_score,
    r.avg_score,
    r.overall_accuracy,
    `"${(r.top_student || "").replace(/"/g, '""')}"`,
  ]);
  const content = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\r\n");
  const blob    = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url     = URL.createObjectURL(blob);
  const link    = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `medtrail_college_standings_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Format seconds to "Xm Ys" string for display.
 */
export function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Return a sign-prefixed string for score change display.
 */
export function formatScoreChange(change: number | null): string {
  if (change === null || change === undefined) return "—";
  if (change > 0) return `+${change}`;
  if (change < 0) return `${change}`;
  return "—";
}
