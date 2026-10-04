/**
 * OverallLeaderboard — Admin-Only Overall Championship Analytics Dashboard
 *
 * Provides:
 *  - Summary stat cards
 *  - Admin-controlled filter bar (date range, pulse selection, college, batch, min attempts)
 *  - Sortable, paginated student leaderboard table
 *  - College standings tab
 *  - Student detail drawer (attempt-by-attempt history)
 *  - CSV export
 *  - Realtime-aware: Refresh button + last-calculated timestamp
 *
 * Authorization: Rendered only inside SuperAdminControlCenter (route-level guard).
 * The RPC additionally enforces is_admin() server-side.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Trophy,
  Users,
  Target,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Download,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Building,
  GraduationCap,
  Calendar,
  Award,
  BarChart3,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  fetchOverallLeaderboard,
  fetchOverallCollegeStandings,
  fetchAvailablePulses,
  computeSummaryStats,
  exportOverallLeaderboardToCSV,
  exportCollegeStandingsToCSV,
  formatTime,
  formatScoreChange,
  DEFAULT_FILTERS,
  type OverallLeaderboardFilters,
  type OverallStudentRow,
  type OverallCollegeRow,
  type PulseListItem,
  type RankingMetric,
} from "@/lib/overall-leaderboard-service";

// ── Types ──────────────────────────────────────────────────────────────────────

type SortField =
  | "rank"
  | "student_name"
  | "college"
  | "batch"
  | "total_score"
  | "avg_score"
  | "best_score"
  | "overall_accuracy"
  | "attempts_count"
  | "avg_time_seconds"
  | "score_change";

type SortDir = "asc" | "desc";

// ── Utility ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function rankBadge(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function ScoreChangeBadge({ change, pct }: { change: number | null; pct: number | null }) {
  if (change === null) return <span className="text-slate-500">—</span>;
  if (change > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-400 font-mono text-xs font-bold">
        <TrendingUp className="w-3 h-3" />
        {formatScoreChange(change)}
        {pct !== null && <span className="text-emerald-500/70 text-[10px]"> ({pct > 0 ? "+" : ""}{pct?.toFixed(1)}%)</span>}
      </span>
    );
  if (change < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-rose-400 font-mono text-xs font-bold">
        <TrendingDown className="w-3 h-3" />
        {formatScoreChange(change)}
        {pct !== null && <span className="text-rose-500/70 text-[10px]"> ({pct?.toFixed(1)}%)</span>}
      </span>
    );
  return <span className="inline-flex items-center gap-0.5 text-slate-400 text-xs"><Minus className="w-3 h-3" /> 0</span>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "amber",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: "amber" | "emerald" | "blue" | "purple" | "rose" | "cyan";
}) {
  const colorMap: Record<string, string> = {
    amber:   "border-amber-500/30 text-amber-400 bg-amber-500/10",
    emerald: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    blue:    "border-blue-500/30 text-blue-400 bg-blue-500/10",
    purple:  "border-purple-500/30 text-purple-400 bg-purple-500/10",
    rose:    "border-rose-500/30 text-rose-400 bg-rose-500/10",
    cyan:    "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
  };
  const cls = colorMap[color] ?? colorMap["amber"] ?? "";
  const parts = cls.split(" ");
  const borderCls = parts[0] ?? "";
  const textCls   = parts[1] ?? "";
  const bgCls     = parts[2] ?? "";

  return (
    <div className={`p-5 rounded-3xl bg-slate-900/60 border backdrop-blur-md relative overflow-hidden shadow-xl ${borderCls}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${textCls}`}>{label}</span>
        <span className={`p-2 rounded-xl border ${borderCls} ${bgCls}`}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <div className={`text-2xl font-black font-mono ${textCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="w-3 h-3 text-slate-600" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 text-amber-400" />
    : <ChevronDown className="w-3 h-3 text-amber-400" />;
}

// ── Student Detail Drawer ──────────────────────────────────────────────────────

function StudentDrawer({ student, onClose }: { student: OverallStudentRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-xl font-black text-amber-400 font-mono">
              {rankBadge(student.rank)}
            </div>
            <div>
              <div className="text-lg font-black text-white">{student.student_name}</div>
              <div className="text-xs text-slate-400">{student.college}</div>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
            <GraduationCap className="w-3 h-3" /> {student.batch}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { l: "Total Score", v: student.total_score.toLocaleString(), c: "text-amber-400" },
            { l: "Average Score", v: student.avg_score.toFixed(1), c: "text-emerald-400" },
            { l: "Best Score", v: student.best_score.toLocaleString(), c: "text-blue-400" },
            { l: "Attempts", v: student.attempts_count.toString(), c: "text-purple-400" },
            { l: "Accuracy", v: `${student.overall_accuracy.toFixed(1)}%`, c: "text-cyan-400" },
            { l: "Avg Time", v: formatTime(student.avg_time_seconds), c: "text-rose-400" },
            { l: "Total XP", v: student.total_xp.toLocaleString(), c: "text-yellow-400" },
            { l: "Last Active", v: formatDate(student.last_attempt_at), c: "text-slate-300" },
          ].map(({ l, v, c }) => (
            <div key={l} className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">{l}</div>
              <div className={`text-base font-black font-mono ${c}`}>{v}</div>
            </div>
          ))}
        </div>

        {/* Trend */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">Latest vs Previous Attempt</div>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-[10px] text-slate-500">Previous</div>
              <div className="text-lg font-black font-mono text-slate-300">{student.prev_score ?? "—"}</div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <ScoreChangeBadge change={student.score_change} pct={student.pct_change} />
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500">Latest</div>
              <div className="text-lg font-black font-mono text-amber-400">{student.latest_score ?? "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function OverallLeaderboard() {
  // ── State ────────────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<"individual" | "college">("individual");
  const [filters, setFilters]       = useState<OverallLeaderboardFilters>(DEFAULT_FILTERS);
  const [pendingFilters, setPending] = useState<OverallLeaderboardFilters>(DEFAULT_FILTERS);

  const [rows, setRows]             = useState<OverallStudentRow[]>([]);
  const [collegeRows, setCollegeRows] = useState<OverallCollegeRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [lastCalcAt, setLastCalcAt] = useState<string | null>(null);

  const [pulseList, setPulseList]   = useState<PulseListItem[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [isLoadingColleges, setIsLoadingColleges] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [search, setSearch]         = useState("");
  const [sortField, setSortField]   = useState<SortField>("rank");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [selectedStudent, setSelectedStudent] = useState<OverallStudentRow | null>(null);

  // ── Data Fetching ─────────────────────────────────────────────────────────────

  const loadPulses = useCallback(async () => {
    try {
      const list = await fetchAvailablePulses();
      setPulseList(list);
    } catch {
      // Non-critical
    }
  }, []);

  const loadLeaderboard = useCallback(async (f: OverallLeaderboardFilters) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchOverallLeaderboard(f);
      setRows(result.data);
      setTotalCount(result.total_count);
      setLastCalcAt(result.last_calculated_at);
    } catch (err: any) {
      const msg = err?.message || "Failed to load overall leaderboard";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadColleges = useCallback(async (f: OverallLeaderboardFilters) => {
    setIsLoadingColleges(true);
    try {
      const result = await fetchOverallCollegeStandings({
        startDate: f.startDate,
        endDate: f.endDate,
        pulseIds: f.pulseIds,
        batchFilter: f.batchFilter,
      });
      setCollegeRows(result.data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load college standings");
    } finally {
      setIsLoadingColleges(false);
    }
  }, []);

  useEffect(() => {
    loadPulses();
    loadLeaderboard(DEFAULT_FILTERS);
    loadColleges(DEFAULT_FILTERS);
  }, [loadPulses, loadLeaderboard, loadColleges]);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const summary = useMemo(() => computeSummaryStats(rows, collegeRows), [rows, collegeRows]);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = q
      ? rows.filter(
          (r) =>
            r.student_name.toLowerCase().includes(q) ||
            r.college.toLowerCase().includes(q) ||
            r.batch.toLowerCase().includes(q)
        )
      : rows;

    // Client-side sort (server already sorted by ranking metric for default)
    result = [...result].sort((a, b) => {
      const mult = sortDir === "asc" ? 1 : -1;
      if (sortField === "student_name" || sortField === "college" || sortField === "batch") {
        return mult * String(a[sortField] ?? "").localeCompare(String(b[sortField] ?? ""));
      }
      const va = Number((a as any)[sortField] ?? 0);
      const vb = Number((b as any)[sortField] ?? 0);
      return mult * (va - vb);
    });
    return result;
  }, [rows, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize));

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function handleApplyFilters() {
    const applied = { ...pendingFilters, page: 1 };
    setFilters(applied);
    loadLeaderboard(applied);
    loadColleges(applied);
  }

  function handleResetFilters() {
    setPending(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    loadLeaderboard(DEFAULT_FILTERS);
    loadColleges(DEFAULT_FILTERS);
  }

  function handleRefresh() {
    loadLeaderboard(filters);
    loadColleges(filters);
    toast.success("Overall leaderboard recalculated");
  }

  function handlePageChange(p: number) {
    const next = { ...filters, page: p };
    setFilters(next);
    loadLeaderboard(next);
  }

  function handlePulseToggle(pid: string) {
    const current = pendingFilters.pulseIds ?? [];
    const next = current.includes(pid)
      ? current.filter((x) => x !== pid)
      : [...current, pid];
    setPending({ ...pendingFilters, pulseIds: next.length === 0 ? null : next });
  }

  const quickRanges = [
    { label: "All Time", start: null, end: null },
    { label: "Today", start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) },
    {
      label: "Last 7 Days",
      start: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
    },
    {
      label: "Last 30 Days",
      start: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
    },
    {
      label: "This Month",
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Section Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <h2 className="text-xl font-black text-white">Overall Championship Analytics</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 ml-9">
            Cumulative performance across all Pulses — admin-only view.
            {lastCalcAt && (
              <span className="ml-2 text-slate-500">
                Last calculated: <strong className="text-amber-400/80">{new Date(lastCalcAt).toLocaleTimeString("en-IN")}</strong>
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 ml-9 sm:ml-0">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Recalculate
          </button>
          <button
            onClick={() => {
              if (activeView === "individual") exportOverallLeaderboardToCSV(filteredRows, filters);
              else exportCollegeStandingsToCSV(collegeRows);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition cursor-pointer shadow-lg shadow-amber-500/20"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5 text-amber-400" />
          Championship Analytics Filters
        </div>

        {/* Quick date ranges */}
        <div className="flex flex-wrap gap-2">
          {quickRanges.map((r) => (
            <button
              key={r.label}
              onClick={() => setPending((p) => ({ ...p, startDate: r.start, endDate: r.end }))}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                pendingFilters.startDate === r.start && pendingFilters.endDate === r.end
                  ? "bg-amber-500 text-slate-950"
                  : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Date inputs + filters row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono uppercase">Start Date</label>
            <input
              type="date"
              value={pendingFilters.startDate ?? ""}
              onChange={(e) => setPending((p) => ({ ...p, startDate: e.target.value || null }))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono uppercase">End Date</label>
            <input
              type="date"
              value={pendingFilters.endDate ?? ""}
              onChange={(e) => setPending((p) => ({ ...p, endDate: e.target.value || null }))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono uppercase">College</label>
            <input
              type="text"
              placeholder="All colleges"
              value={pendingFilters.collegeFilter ?? ""}
              onChange={(e) => setPending((p) => ({ ...p, collegeFilter: e.target.value || null }))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono uppercase">Batch</label>
            <select
              value={pendingFilters.batchFilter ?? ""}
              onChange={(e) => setPending((p) => ({ ...p, batchFilter: e.target.value || null }))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 transition"
            >
              <option value="">All Batches</option>
              <option value="2026 Batch → Freshers">2026 Batch — Freshers</option>
              <option value="2025 Batch → 1st Year MBBS">2025 Batch — 1st Year</option>
              <option value="2024 Batch → 2nd Year MBBS">2024 Batch — 2nd Year</option>
              <option value="2023 Batch → 3rd Year MBBS">2023 Batch — 3rd Year</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono uppercase">Min Attempts</label>
            <input
              type="number"
              min={1}
              max={50}
              value={pendingFilters.minAttempts}
              onChange={(e) => setPending((p) => ({ ...p, minAttempts: Math.max(1, Number(e.target.value)) }))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 transition"
            />
          </div>
        </div>

        {/* Pulse selector */}
        {pulseList.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-500 font-mono uppercase">Pulse Selection</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setPending((p) => ({ ...p, pulseIds: null }))}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                  !pendingFilters.pulseIds
                    ? "bg-amber-500 text-slate-950"
                    : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
                }`}
              >
                All Pulses
              </button>
              {pulseList.map((p) => (
                <button
                  key={p.pulse_id}
                  onClick={() => handlePulseToggle(p.pulse_id)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                    pendingFilters.pulseIds?.includes(p.pulse_id)
                      ? "bg-amber-500/80 text-slate-950 border border-amber-400"
                      : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
                  }`}
                  title={`${p.submission_count} submissions`}
                >
                  {p.pulse_date}
                  {p.submission_count > 0 && (
                    <span className="ml-1 opacity-60">({p.submission_count})</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ranking metric */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] text-slate-500 font-mono uppercase">Rank By:</span>
          {(["total_score", "avg_score", "accuracy"] as RankingMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setPending((p) => ({ ...p, rankingMetric: m }))}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                pendingFilters.rankingMetric === m
                  ? "bg-blue-500 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
              }`}
            >
              {m === "total_score" ? "Total Score" : m === "avg_score" ? "Average Score" : "Accuracy"}
            </button>
          ))}
        </div>

        {/* Apply / Reset */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApplyFilters}
            className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/20"
          >
            Apply Filters
          </button>
          <button
            onClick={handleResetFilters}
            className="px-5 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer border border-slate-700"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users}       label="Students"      value={summary.total_students.toLocaleString()} sub="Eligible participants" color="blue" />
        <StatCard icon={BarChart3}   label="Attempts"      value={summary.total_eligible_attempts.toLocaleString()} sub="Valid submissions" color="purple" />
        <StatCard icon={Trophy}      label="Total Points"  value={summary.total_points_scored.toLocaleString()} sub="Combined score" color="amber" />
        <StatCard icon={Target}      label="Avg Score"     value={summary.average_score.toFixed(1)} sub="Mean score per student" color="emerald" />
        <StatCard icon={CheckCircle2} label="Accuracy"    value={`${summary.overall_accuracy.toFixed(1)}%`} sub="Overall correctness" color="cyan" />
        <StatCard icon={Sparkles}    label="Top Student"   value={summary.highest_ranked_student.split(" ").slice(0, 2).join(" ")} sub={summary.highest_ranked_college.slice(0, 28)} color="rose" />
      </div>

      {/* ── View Tabs ── */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        {(["individual", "college"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
              activeView === v
                ? "bg-amber-500 text-slate-950"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {v === "individual" ? (
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Individual Ranking</span>
            ) : (
              <span className="flex items-center gap-1.5"><Building className="w-3.5 h-3.5" />College Standings</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Individual Leaderboard ── */}
      {activeView === "individual" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search by name, college, or batch..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-9 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 transition"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              {totalCount} students
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Table */}
          <div className="rounded-3xl overflow-hidden border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/60">
                    {[
                      { f: "rank" as SortField, label: "Rank", w: "w-14" },
                      { f: "student_name" as SortField, label: "Student", w: "min-w-[160px]" },
                      { f: "college" as SortField, label: "College", w: "min-w-[180px]" },
                      { f: "batch" as SortField, label: "Batch", w: "w-28" },
                      { f: "total_score" as SortField, label: "Total", w: "w-16" },
                      { f: "avg_score" as SortField, label: "Avg", w: "w-14" },
                      { f: "overall_accuracy" as SortField, label: "Accuracy", w: "w-20" },
                      { f: "attempts_count" as SortField, label: "Attempts", w: "w-18" },
                      { f: "best_score" as SortField, label: "Best", w: "w-14" },
                      { f: "score_change" as SortField, label: "Change", w: "w-24" },
                      { f: "avg_time_seconds" as SortField, label: "Avg Time", w: "w-20" },
                    ].map(({ f, label, w }) => (
                      <th
                        key={f}
                        onClick={() => handleSort(f)}
                        className={`${w} px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer hover:text-slate-300 select-none transition whitespace-nowrap`}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          <SortIcon field={f} sortField={sortField} sortDir={sortDir} />
                        </span>
                      </th>
                    ))}
                    <th className="w-10 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={12} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3 text-slate-500">
                          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                          <span className="text-sm">Calculating leaderboard…</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-16 text-center text-slate-500 text-sm">
                        {error ? "Failed to load data." : "No students match the selected filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, idx) => {
                      const isTop = r.rank <= 3;
                      return (
                        <tr
                          key={r.user_id}
                          className={`border-b border-slate-800/40 transition cursor-pointer group ${
                            isTop
                              ? "bg-amber-500/3 hover:bg-amber-500/8"
                              : idx % 2 === 0
                              ? "bg-slate-900/20 hover:bg-slate-800/40"
                              : "hover:bg-slate-800/40"
                          }`}
                          onClick={() => setSelectedStudent(r)}
                        >
                          {/* Rank */}
                          <td className="px-3 py-3 font-mono text-center">
                            <span className={`text-base ${r.rank === 1 ? "text-yellow-400" : r.rank === 2 ? "text-slate-300" : r.rank === 3 ? "text-amber-700" : "text-slate-500 text-xs"}`}>
                              {rankBadge(r.rank)}
                            </span>
                          </td>
                          {/* Name */}
                          <td className="px-3 py-3">
                            <div className="font-semibold text-white group-hover:text-amber-300 transition truncate max-w-[160px]">
                              {r.student_name}
                            </div>
                          </td>
                          {/* College */}
                          <td className="px-3 py-3 text-slate-400 truncate max-w-[180px]" title={r.college}>
                            {r.college.length > 30 ? r.college.slice(0, 30) + "…" : r.college}
                          </td>
                          {/* Batch */}
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[10px] font-mono whitespace-nowrap">
                              {r.batch.match(/\d{4}/)?.[0] ?? r.batch.slice(0, 4)}
                            </span>
                          </td>
                          {/* Total Score */}
                          <td className="px-3 py-3 font-mono font-black text-amber-400">
                            {r.total_score.toLocaleString()}
                          </td>
                          {/* Avg */}
                          <td className="px-3 py-3 font-mono text-emerald-400">
                            {r.avg_score.toFixed(1)}
                          </td>
                          {/* Accuracy */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden w-12">
                                <div
                                  className="h-full rounded-full bg-cyan-500"
                                  style={{ width: `${Math.min(100, r.overall_accuracy)}%` }}
                                />
                              </div>
                              <span className="font-mono text-cyan-400 whitespace-nowrap">
                                {r.overall_accuracy.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          {/* Attempts */}
                          <td className="px-3 py-3 font-mono text-purple-400 text-center">
                            {r.attempts_count}
                          </td>
                          {/* Best */}
                          <td className="px-3 py-3 font-mono text-blue-400">
                            {r.best_score}
                          </td>
                          {/* Change */}
                          <td className="px-3 py-3">
                            <ScoreChangeBadge change={r.score_change} pct={r.pct_change} />
                          </td>
                          {/* Avg Time */}
                          <td className="px-3 py-3 font-mono text-slate-400">
                            {formatTime(r.avg_time_seconds)}
                          </td>
                          {/* Detail arrow */}
                          <td className="px-3 py-3">
                            <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-amber-400 transition" />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-slate-500 font-mono">
                Page {filters.page} of {totalPages} · {totalCount} students
              </span>
              <div className="flex gap-2">
                <button
                  disabled={filters.page <= 1}
                  onClick={() => handlePageChange(filters.page - 1)}
                  className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={filters.page >= totalPages}
                  onClick={() => handlePageChange(filters.page + 1)}
                  className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── College Standings ── */}
      {activeView === "college" && (
        <div className="rounded-3xl overflow-hidden border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-950/60">
                  {["Rank", "College", "Students", "Attempts", "Combined Score", "Avg Score", "Accuracy", "Top Student"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoadingColleges ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <Loader2 className="w-7 h-7 animate-spin text-amber-500 mx-auto" />
                    </td>
                  </tr>
                ) : collegeRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500 text-sm">
                      No college data for the selected filters.
                    </td>
                  </tr>
                ) : (
                  collegeRows.map((c, idx) => (
                    <tr key={c.college} className={`border-b border-slate-800/40 ${idx % 2 === 0 ? "bg-slate-900/20" : ""} hover:bg-slate-800/30 transition`}>
                      <td className="px-4 py-3 font-mono text-center">
                        <span className={`text-base ${c.rank === 1 ? "text-yellow-400" : c.rank === 2 ? "text-slate-300" : c.rank === 3 ? "text-amber-700" : "text-slate-500 text-xs"}`}>
                          {rankBadge(c.rank)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white max-w-[220px] truncate" title={c.college}>{c.college}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-blue-400 text-center">{c.student_count}</td>
                      <td className="px-4 py-3 font-mono text-purple-400 text-center">{c.total_attempts}</td>
                      <td className="px-4 py-3 font-mono font-black text-amber-400">{c.combined_score.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400">{c.avg_score.toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden w-12">
                            <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(100, c.overall_accuracy)}%` }} />
                          </div>
                          <span className="font-mono text-cyan-400">{c.overall_accuracy.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]">{c.top_student || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Student Detail Drawer ── */}
      {selectedStudent && (
        <StudentDrawer student={selectedStudent} onClose={() => setSelectedStudent(null)} />
      )}
    </div>
  );
}
