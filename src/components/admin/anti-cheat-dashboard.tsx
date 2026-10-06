import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  ChevronRight,
  Info,
  Lock,
  User,
  GraduationCap,
  Building,
  Calendar,
  FileText,
  Radio,
  Zap,
  Terminal,
  X,
  ExternalLink,
  Flame,
  Award,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAntiCheatStats,
  fetchAttemptsWithTelemetry,
  fetchAttemptTelemetryTimeline,
  fetchSessionDetails,
  submitAttemptReview,
  ENGINE_RULEBOOK_PARAMETERS,
  type AntiCheatDashboardStats,
  type SuspiciousAttemptRow,
  type AntiCheatEventDetail,
  type PulseSessionDetail,
  type RiskLevel,
  type ReviewStatus,
  type AntiCheatFilterOptions,
} from "@/lib/anti-cheat-admin-service";

export function AntiCheatDashboard() {
  // ── 1. Telemetry Stats State ───────────────────────────────────────────────
  const [stats, setStats] = useState<AntiCheatDashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // ── 2. Attempts Table State ────────────────────────────────────────────────
  const [attempts, setAttempts] = useState<SuspiciousAttemptRow[]>([]);
  const [isLoadingAttempts, setIsLoadingAttempts] = useState(true);

  // ── 3. Filters State ───────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [collegeFilter, setCollegeFilter] = useState("all");

  // ── 4. Live Stream & Auto-Refresh State ─────────────────────────────────────
  const [isLiveActive, setIsLiveActive] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── 5. Detailed Review Drawer / Modal State ────────────────────────────────
  const [selectedAttempt, setSelectedAttempt] = useState<SuspiciousAttemptRow | null>(null);
  const [selectedSession, setSelectedSession] = useState<PulseSessionDetail | null>(null);
  const [eventTimeline, setEventTimeline] = useState<AntiCheatEventDetail[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [timelineTypeFilter, setTimelineTypeFilter] = useState("all");

  // Review mutation state
  const [reviewStatusInput, setReviewStatusInput] = useState<ReviewStatus>("unreviewed");
  const [adminNotesInput, setAdminNotesInput] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // ── Data Fetching Functions ────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const [newStats, newAttempts] = await Promise.all([
        fetchAntiCheatStats(),
        fetchAttemptsWithTelemetry({
          search,
          riskLevel: riskFilter,
          reviewStatus: statusFilter,
          pulseDate: dateFilter,
          college: collegeFilter,
        }),
      ]);

      setStats(newStats);
      setAttempts(newAttempts);
    } catch (err) {
      console.error("[AntiCheatDashboard] Load error:", err);
      toast.error("Failed to refresh anti-cheat telemetry.");
    } finally {
      setIsLoadingStats(false);
      setIsLoadingAttempts(false);
      setIsRefreshing(false);
    }
  }, [search, riskFilter, statusFilter, dateFilter, collegeFilter]);

  // Initial load and filter change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh interval (10 seconds when live active)
  useEffect(() => {
    if (!isLiveActive) return;
    const interval = setInterval(() => {
      loadData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [isLiveActive, loadData]);

  // Realtime Supabase channel subscriptions for instant alerts
  useEffect(() => {
    const channel = supabase
      .channel("anti_cheat_surveillance_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_pulse_sessions" },
        () => loadData(true)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "championship_anti_cheat_events" },
        () => loadData(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_pulse_attempts" },
        () => loadData(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Distinct filter options extracted from attempts
  const distinctDates = useMemo(() => {
    const set = new Set<string>();
    attempts.forEach((a) => {
      if (a.pulse_date) set.add(a.pulse_date);
    });
    return Array.from(set).sort().reverse();
  }, [attempts]);

  const distinctColleges = useMemo(() => {
    const set = new Set<string>();
    attempts.forEach((a) => {
      if (a.college && a.college !== "N/A") set.add(a.college);
    });
    return Array.from(set).sort();
  }, [attempts]);

  // Handle opening detailed review
  const handleOpenReview = async (attempt: SuspiciousAttemptRow) => {
    setSelectedAttempt(attempt);
    setReviewStatusInput(attempt.review_status);
    setAdminNotesInput(attempt.admin_notes || "");
    setIsLoadingTimeline(true);

    try {
      if (attempt.session_id) {
        const [timeline, session] = await Promise.all([
          fetchAttemptTelemetryTimeline(attempt.session_id),
          fetchSessionDetails(attempt.session_id),
        ]);
        setEventTimeline(timeline);
        setSelectedSession(session);
      } else {
        setEventTimeline([]);
        setSelectedSession(null);
      }
    } catch (err) {
      console.error("[AntiCheatDashboard] Error loading timeline:", err);
      toast.error("Failed to load attempt telemetry events.");
    } finally {
      setIsLoadingTimeline(false);
    }
  };

  const handleCloseReview = () => {
    setSelectedAttempt(null);
    setSelectedSession(null);
    setEventTimeline([]);
  };

  // Submit Review Action
  const handleSubmitReviewDecision = async () => {
    if (!selectedAttempt) return;

    setIsSubmittingReview(true);
    try {
      const res = await submitAttemptReview(
        selectedAttempt.id,
        reviewStatusInput,
        adminNotesInput
      );

      if (res.success) {
        toast.success(`Attempt marked as ${reviewStatusInput.toUpperCase()}!`);
        // Update local state
        setAttempts((prev) =>
          prev.map((a) =>
            a.id === selectedAttempt.id
              ? {
                  ...a,
                  review_status: reviewStatusInput,
                  admin_notes: adminNotesInput.trim() || null,
                  reviewed_at: new Date().toISOString(),
                }
              : a
          )
        );
        setSelectedAttempt((prev) =>
          prev
            ? {
                ...prev,
                review_status: reviewStatusInput,
                admin_notes: adminNotesInput.trim() || null,
                reviewed_at: new Date().toISOString(),
              }
            : null
        );
        loadData(true);
      } else {
        toast.error(res.error || "Failed to update review status.");
      }
    } catch (err: any) {
      toast.error("Review operation error: " + (err.message || String(err)));
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Filtered timeline events
  const filteredEvents = useMemo(() => {
    if (timelineTypeFilter === "all") return eventTimeline;
    return eventTimeline.filter(
      (e) => e.event_type.toUpperCase() === timelineTypeFilter.toUpperCase()
    );
  }, [eventTimeline, timelineTypeFilter]);

  // Distinct event types in timeline
  const distinctEventTypes = useMemo(() => {
    const set = new Set<string>();
    eventTimeline.forEach((e) => set.add(e.event_type));
    return Array.from(set).sort();
  }, [eventTimeline]);

  // Helper badge stylers
  const getRiskBadge = (level: RiskLevel, score: number) => {
    switch (level) {
      case "critical":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            CRITICAL ({score})
          </span>
        );
      case "high":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-300 font-mono text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
            HIGH ({score})
          </span>
        );
      case "medium":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            MEDIUM ({score})
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            LOW ({score})
          </span>
        );
    }
  };

  const getReviewStatusBadge = (status: ReviewStatus) => {
    switch (status) {
      case "flagged":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold uppercase tracking-wider">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            FLAGGED
          </span>
        );
      case "disqualified":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] font-bold uppercase tracking-wider">
            <XCircle className="w-3 h-3 text-rose-400" />
            DISQUALIFIED
          </span>
        );
      case "cleared":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            CLEARED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
            <Clock className="w-3 h-3 text-slate-400" />
            UNREVIEWED
          </span>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* ── HEADER BANNER ── */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/30 bg-gradient-to-br from-slate-950 via-[#150d14] to-slate-950 p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-16 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-[11px] font-bold tracking-wider uppercase">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                SHIELD-CORE ACTIVE
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[11px] font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                {isLiveActive ? "Live Stream Connected" : "Stream Paused"}
              </span>
              {stats?.lastUpdated && (
                <span className="font-mono text-xs text-slate-400">
                  Last sync: <strong className="text-slate-200">{stats.lastUpdated}</strong>
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight flex items-center gap-3">
              <span>🛡️ Anti-Cheat Surveillance</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              Passive browser integrity telemetry, automated heuristics, and authoritative admin review audits. Risk scores inform admin reviews only and never alter stored scores or ranks automatically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsLiveActive((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-bold transition shadow-lg cursor-pointer ${
                isLiveActive
                  ? "bg-slate-900 border-emerald-500/40 text-emerald-300 hover:bg-slate-800"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isLiveActive ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
              <span>{isLiveActive ? "Auto-Refresh ON (10s)" : "Auto-Refresh OFF"}</span>
            </button>

            <button
              disabled={isRefreshing}
              onClick={() => loadData()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-black text-xs transition shadow-lg shadow-rose-500/25 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Syncing..." : "Refresh Stream"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 8 KEY METRICS DASHBOARD CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Metric 1 */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Sessions</div>
          <div className="mt-2 text-2xl font-black text-emerald-400 font-mono flex items-center gap-1.5">
            {isLoadingStats ? "..." : stats?.activeSessionsCount ?? 0}
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Monitored live</div>
        </div>

        {/* Metric 2 */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Users</div>
          <div className="mt-2 text-2xl font-black text-white font-mono">
            {isLoadingStats ? "..." : stats?.activeParticipantsCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">In active quiz</div>
        </div>

        {/* Metric 3 */}
        <div className="rounded-2xl bg-slate-900/80 border border-emerald-500/20 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Low Risk</div>
          <div className="mt-2 text-2xl font-black text-emerald-400 font-mono">
            {isLoadingStats ? "..." : stats?.lowRiskCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">&lt; 25 risk score</div>
        </div>

        {/* Metric 4 */}
        <div className="rounded-2xl bg-slate-900/80 border border-amber-500/20 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Medium Risk</div>
          <div className="mt-2 text-2xl font-black text-amber-400 font-mono">
            {isLoadingStats ? "..." : stats?.mediumRiskCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">25 - 49 score</div>
        </div>

        {/* Metric 5 */}
        <div className="rounded-2xl bg-slate-900/80 border border-orange-500/20 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400">High Risk</div>
          <div className="mt-2 text-2xl font-black text-orange-400 font-mono">
            {isLoadingStats ? "..." : stats?.highRiskCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">50 - 74 score</div>
        </div>

        {/* Metric 6 */}
        <div className="rounded-2xl bg-slate-900/80 border border-rose-500/30 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Critical Risk</div>
          <div className="mt-2 text-2xl font-black text-rose-400 font-mono">
            {isLoadingStats ? "..." : stats?.criticalRiskCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">&ge; 75 score</div>
        </div>

        {/* Metric 7 */}
        <div className="rounded-2xl bg-slate-900/80 border border-amber-500/30 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Flagged</div>
          <div className="mt-2 text-2xl font-black text-amber-300 font-mono">
            {isLoadingStats ? "..." : stats?.flaggedAttemptsCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Awaiting audit</div>
        </div>

        {/* Metric 8 */}
        <div className="rounded-2xl bg-slate-900/80 border border-cyan-500/20 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Total Events</div>
          <div className="mt-2 text-2xl font-black text-cyan-300 font-mono">
            {isLoadingStats ? "..." : stats?.totalEventsCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Telemetry logged</div>
        </div>
      </div>

      {/* ── FILTER & SEARCH TOOLBAR ── */}
      <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name, email, or college..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition"
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Risk filter */}
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="all">Risk: All Levels</option>
              <option value="low">Low Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="high">High Risk</option>
              <option value="critical">Critical Risk</option>
            </select>

            {/* Review status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="all">Status: All Reviews</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="flagged">Flagged</option>
              <option value="cleared">Cleared</option>
              <option value="disqualified">Disqualified</option>
            </select>

            {/* Pulse Date filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="all">Date: All Pulses</option>
              {distinctDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* College filter */}
            <select
              value={collegeFilter}
              onChange={(e) => setCollegeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-rose-500 max-w-[180px] truncate cursor-pointer"
            >
              <option value="all">College: All Colleges</option>
              {distinctColleges.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Clear Filters */}
            {(search || riskFilter !== "all" || statusFilter !== "all" || dateFilter !== "all" || collegeFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setRiskFilter("all");
                  setStatusFilter("all");
                  setDateFilter("all");
                  setCollegeFilter("all");
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/60">
          <span>
            Showing <strong className="text-white">{attempts.length}</strong> attempts matching filters
          </span>
          <span className="text-slate-500 text-[11px]">
            Click any row to inspect complete browser telemetry timeline & audit decision
          </span>
        </div>
      </div>

      {/* ── LIVE SUSPICIOUS-ATTEMPT TABLE ── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">College & Batch</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Risk Score</th>
                <th className="py-3 px-4">Risk Level</th>
                <th className="py-3 px-4">Review Status</th>
                <th className="py-3 px-4 text-center">Events</th>
                <th className="py-3 px-4">Submitted</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoadingAttempts ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
                      <span>Loading attempts & anti-cheat records...</span>
                    </div>
                  </td>
                </tr>
              ) : attempts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <ShieldCheck className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p className="font-semibold text-slate-400">No attempts found matching the current filters.</p>
                    <p className="text-[11px] text-slate-500 mt-1">Try resetting the risk or review filters.</p>
                  </td>
                </tr>
              ) : (
                attempts.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => handleOpenReview(row)}
                    className="hover:bg-slate-800/50 transition cursor-pointer group"
                  >
                    {/* Student */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-white group-hover:text-rose-300 transition">
                        {row.student_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                        {row.user_email}
                      </div>
                    </td>

                    {/* College & Batch */}
                    <td className="py-3 px-4 max-w-[220px]">
                      <div className="truncate text-slate-300" title={row.college}>
                        {row.college}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{row.batch}</div>
                    </td>

                    {/* Pulse Date */}
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {row.pulse_date}
                    </td>

                    {/* Risk Score */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              row.risk_score >= 75
                                ? "bg-rose-500"
                                : row.risk_score >= 50
                                ? "bg-orange-500"
                                : row.risk_score >= 25
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(5, row.risk_score))}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-xs text-white">{row.risk_score}</span>
                      </div>
                    </td>

                    {/* Risk Level */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getRiskBadge(row.risk_level, row.risk_score)}
                    </td>

                    {/* Review Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getReviewStatusBadge(row.review_status)}
                    </td>

                    {/* Event count */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full font-mono text-xs font-bold ${
                          row.events_count > 0
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {row.events_count}
                      </span>
                    </td>

                    {/* Submitted time */}
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {row.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "N/A"}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenReview(row);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500 hover:text-slate-950 text-slate-300 text-xs font-bold transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── HEURISTIC ENGINE SPECIFICATION & LOCKED RULES INSPECTOR ── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Anti-Cheat Engine Parameters (Database-Enforced)
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[10px]">
            <Lock className="w-3 h-3 text-amber-400" />
            Locked Server Policy
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          The following parameters are authoritatively encoded into the PostgreSQL database via migration{" "}
          <code className="text-rose-400 font-mono">20261005_anti_cheat_production_system.sql</code>. They are executed with
          SECURITY DEFINER guarantees and cannot be bypassed by client requests.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Tab Hidden Penalty</div>
            <div className="text-base font-black text-amber-400 font-mono mt-1">
              +{ENGINE_RULEBOOK_PARAMETERS.tabHiddenPenalty} pts
            </div>
            <div className="text-[10px] text-slate-500">Per visibility change</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">DevTools Open Penalty</div>
            <div className="text-base font-black text-rose-400 font-mono mt-1">
              +{ENGINE_RULEBOOK_PARAMETERS.devToolsPenalty} pts
            </div>
            <div className="text-[10px] text-slate-500">Critical violation heuristic</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Copy/Paste Penalty</div>
            <div className="text-base font-black text-orange-400 font-mono mt-1">
              +{ENGINE_RULEBOOK_PARAMETERS.copyPastePenalty} pts
            </div>
            <div className="text-[10px] text-slate-500">Clipboard attempt event</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Window Blur Penalty</div>
            <div className="text-base font-black text-slate-300 font-mono mt-1">
              +{ENGINE_RULEBOOK_PARAMETERS.windowBlurPenalty} pts
            </div>
            <div className="text-[10px] text-slate-500">Focus transition out</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Auto-Flag Threshold</div>
            <div className="text-base font-black text-amber-300 font-mono mt-1">
              &ge; {ENGINE_RULEBOOK_PARAMETERS.autoFlagThreshold} pts
            </div>
            <div className="text-[10px] text-slate-500">Marked as 'flagged'</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Critical Threshold</div>
            <div className="text-base font-black text-rose-400 font-mono mt-1">
              &ge; {ENGINE_RULEBOOK_PARAMETERS.criticalThreshold} pts
            </div>
            <div className="text-[10px] text-slate-500">High priority audit</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Session Expiry</div>
            <div className="text-base font-black text-cyan-400 font-mono mt-1">
              {ENGINE_RULEBOOK_PARAMETERS.sessionTimeoutSeconds}s
            </div>
            <div className="text-[10px] text-slate-500">Server hard cutoff</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Batch Telemetry Cap</div>
            <div className="text-base font-black text-purple-400 font-mono mt-1">
              {ENGINE_RULEBOOK_PARAMETERS.maxBatchEvents} events
            </div>
            <div className="text-[10px] text-slate-500">Rate-limiting protection</div>
          </div>
        </div>
      </div>

      {/* ── DETAILED REVIEW MODAL / DRAWER ── */}
      {selectedAttempt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md">
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-800 bg-slate-900/80">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold uppercase">
                    Attempt Audit
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    ID: {selectedAttempt.id.slice(0, 8)}...
                  </span>
                  {getRiskBadge(selectedAttempt.risk_level, selectedAttempt.risk_score)}
                  {getReviewStatusBadge(selectedAttempt.review_status)}
                </div>
                <h2 className="text-xl font-black text-white">{selectedAttempt.student_name}</h2>
                <div className="text-xs text-slate-400 font-mono">{selectedAttempt.user_email}</div>
              </div>

              <button
                type="button"
                onClick={handleCloseReview}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              {/* Attempt & Exam Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">College</div>
                  <div className="text-xs font-semibold text-white mt-1 truncate" title={selectedAttempt.college}>
                    {selectedAttempt.college}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{selectedAttempt.batch}</div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Pulse Score & XP</div>
                  <div className="text-base font-black text-amber-400 font-mono mt-1">
                    {selectedAttempt.score} pts
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">+{selectedAttempt.xp} XP</div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Accuracy & Time</div>
                  <div className="text-base font-black text-emerald-400 font-mono mt-1">
                    {selectedAttempt.accuracy}%
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {selectedAttempt.time_taken_seconds} seconds
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Session State</div>
                  <div className="text-xs font-mono font-bold text-white mt-1 truncate">
                    {selectedSession?.status ?? (selectedAttempt.session_id ? "submitted" : "legacy_submission")}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {selectedAttempt.session_id ? `ID: ${selectedAttempt.session_id.slice(0, 8)}` : "No session token"}
                  </div>
                </div>
              </div>

              {/* ADMIN REVIEW CONTROLS CARD */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-900/90 border border-amber-500/30 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Authoritative Admin Review Action
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Executes RPC: <code className="text-amber-300 font-mono">admin_review_pulse_attempt</code>
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Status Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300">Set Review Status:</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["unreviewed", "flagged", "cleared", "disqualified"] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setReviewStatusInput(st)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold uppercase transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            reviewStatusInput === st
                              ? st === "disqualified"
                                ? "bg-rose-500 text-slate-950 font-black shadow-lg"
                                : st === "flagged"
                                ? "bg-amber-500 text-slate-950 font-black shadow-lg"
                                : st === "cleared"
                                ? "bg-emerald-500 text-slate-950 font-black shadow-lg"
                                : "bg-slate-700 text-white font-black"
                              : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {st === "cleared" && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {st === "disqualified" && <XCircle className="w-3.5 h-3.5" />}
                          {st === "flagged" && <AlertTriangle className="w-3.5 h-3.5" />}
                          {st === "unreviewed" && <Clock className="w-3.5 h-3.5" />}
                          <span>{st}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Admin Notes */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300">Admin Audit Notes / Rationale:</label>
                    <textarea
                      value={adminNotesInput}
                      onChange={(e) => setAdminNotesInput(e.target.value)}
                      placeholder="e.g. Cleared after reviewing multi-monitor setup; or Disqualified due to repeated DevTools activation..."
                      rows={3}
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition resize-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
                  <p className="text-[11px] text-slate-400 leading-tight">
                    * The anti-cheat system never modifies stored scores or historical leaderboard points without explicit administrative action.
                  </p>
                  <button
                    type="button"
                    disabled={isSubmittingReview}
                    onClick={handleSubmitReviewDecision}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {isSubmittingReview ? "Saving Decision..." : "Save Review Decision"}
                  </button>
                </div>
              </div>

              {/* COMPLETE ANTI-CHEAT TELEMETRY EVENT TIMELINE */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-cyan-400" />
                      <span>Browser Telemetry Timeline ({eventTimeline.length} Events)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Chronological stream of client integrity beacons recorded during the exam.
                    </p>
                  </div>

                  {distinctEventTypes.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Filter Event:</span>
                      <select
                        value={timelineTypeFilter}
                        onChange={(e) => setTimelineTypeFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none cursor-pointer"
                      >
                        <option value="all">All Events ({eventTimeline.length})</option>
                        {distinctEventTypes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {isLoadingTimeline ? (
                  <div className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-cyan-400 mb-2" />
                    <span>Loading telemetry beacons...</span>
                  </div>
                ) : filteredEvents.length === 0 ? (
                  <div className="p-8 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-slate-500">
                    <Info className="w-6 h-6 mx-auto text-slate-600 mb-2" />
                    <p className="text-xs font-semibold text-slate-400">
                      {selectedAttempt.session_id
                        ? "No telemetry violation events recorded for this session."
                        : "This attempt was submitted via legacy RPC prior to session infrastructure deployment."}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Passive integrity monitoring logs anomalies like tab switches, blur events, or DevTools.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                    {filteredEvents.map((evt, idx) => (
                      <div
                        key={evt.id || idx}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition ${
                          evt.severity === "critical"
                            ? "bg-rose-950/20 border-rose-500/30"
                            : evt.severity === "high"
                            ? "bg-orange-950/20 border-orange-500/30"
                            : evt.severity === "medium"
                            ? "bg-amber-950/20 border-amber-500/30"
                            : "bg-slate-950 border-slate-800"
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                                evt.severity === "critical"
                                  ? "bg-rose-500/30 text-rose-300"
                                  : evt.severity === "high"
                                  ? "bg-orange-500/30 text-orange-300"
                                  : evt.severity === "medium"
                                  ? "bg-amber-500/30 text-amber-300"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {evt.event_type}
                            </span>

                            {evt.risk_delta > 0 && (
                              <span className="text-rose-400 font-mono text-[10px] font-bold">
                                +{evt.risk_delta} Risk
                              </span>
                            )}

                            {evt.duration_ms != null && evt.duration_ms > 0 && (
                              <span className="text-slate-400 font-mono text-[10px]">
                                Duration: {(evt.duration_ms / 1000).toFixed(2)}s
                              </span>
                            )}
                          </div>

                          {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                            <div className="text-[11px] text-slate-400 font-mono bg-slate-900/60 px-2 py-1 rounded max-w-lg truncate">
                              {JSON.stringify(evt.metadata)}
                            </div>
                          )}
                        </div>

                        <div className="text-right text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          {new Date(evt.server_timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-end">
              <button
                type="button"
                onClick={handleCloseReview}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Close Audit Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
