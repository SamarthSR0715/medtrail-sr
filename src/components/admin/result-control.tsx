import { useEffect, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Trophy,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  RefreshCw,
  Award,
  Crown,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Users,
  Search,
  Filter,
  ShieldCheck,
  Send,
  Building,
  GraduationCap,
  Layers,
  Download,
} from "lucide-react";
import {
  fetchResultControlSummary,
  setResultsVisibility,
  toggleLeaderboardFreeze,
  declareSuperAdminFinalResults,
  fetchPulseAttemptsAudit,
  getLeaderboardRankingsData,
  fetchLeaderboardRankingsData,
  type PulseAttemptAuditItem,
  type ResultControlSummary,
  type IndividualRankItem,
  type CollegeRankItem,
  type BatchRankItem,
} from "@/lib/super-admin-service";
import { supabase } from "@/integrations/supabase/client";

export function ResultControl() {
  const [summary, setSummary] = useState<ResultControlSummary | null>(null);
  const [attempts, setAttempts] = useState<PulseAttemptAuditItem[]>([]);
  const [rankingsData, setRankingsData] = useState(() => getLeaderboardRankingsData());
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activePreviewTab, setActivePreviewTab] = useState<"individual" | "college" | "batch" | "attempts">("attempts");

  // Confirmation Modals
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showHideModal, setShowHideModal] = useState(false);
  const [showDeclareModal, setShowDeclareModal] = useState(false);
  const [declareConfirmText, setDeclareConfirmText] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sumData, attData, rankData] = await Promise.all([
        fetchResultControlSummary(),
        fetchPulseAttemptsAudit(),
        fetchLeaderboardRankingsData(),
      ]);
      setSummary(sumData);
      setAttempts(attData);
      setRankingsData(rankData);
    } catch (err) {
      console.error("[ResultControl] load error:", err);
      toast.error("Failed to load result telemetry.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Subscribe to pulse_settings, live_ops, attempts, and standings for instant sync
    const channel = supabase
      .channel("result_control_realtime_sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pulse_settings" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_pulse_attempts" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_leaderboard" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_college_standings" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_batch_standings" },
        () => loadData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_live_ops" },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Filtered attempts
  const filteredAttempts = useMemo(() => {
    if (!searchQuery.trim()) return attempts;
    const q = searchQuery.toLowerCase();
    return attempts.filter(
      (a) =>
        a.student_name.toLowerCase().includes(q) ||
        a.college.toLowerCase().includes(q) ||
        (a.user_email && a.user_email.toLowerCase().includes(q))
    );
  }, [attempts, searchQuery]);

  // Actions
  const handleToggleResults = async (targetPublished: boolean) => {
    setIsUpdating(true);
    try {
      const res = await setResultsVisibility(targetPublished);
      if (res.success) {
        toast.success(
          targetPublished
            ? "🏆 Official Results & Leaderboard PUBLISHED! Visible to all students."
            : "🙈 Results HIDDEN from students. Leaderboard and solutions locked."
        );
        setShowPublishModal(false);
        setShowHideModal(false);
        await loadData();
      } else {
        toast.error(res.error || "Failed to update result visibility.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Action failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleFreeze = async () => {
    if (!summary) return;
    setIsUpdating(true);
    try {
      const nextState = !summary.isLeaderboardFrozen;
      const res = await toggleLeaderboardFreeze(nextState);
      toast.success(
        res
          ? "🔒 Leaderboard FROZEN — Standings are locked."
          : "🔓 Leaderboard UNFROZEN — Live updates active."
      );
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Freeze toggle failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleConfirmDeclareChampion = async () => {
    if (declareConfirmText.trim().toUpperCase() !== "CONFIRM") {
      toast.error("Please type 'CONFIRM' to finalize the champion.");
      return;
    }
    setIsUpdating(true);
    try {
      const res = await declareSuperAdminFinalResults();
      if (res.success) {
        toast.success(`👑 Sovereign Champion Declared: ${res.championName}!`);
        setShowDeclareModal(false);
        setDeclareConfirmText("");
        await loadData();
      }
    } catch (err: any) {
      toast.error(err?.message || "Declaration failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExportCSV = () => {
    if (activePreviewTab === "attempts") {
      if (attempts.length === 0) {
        toast.info("No attempts recorded to export.");
        return;
      }
      const headers = ["Rank,Student Name,Email,College,Batch,Score,Accuracy,Submitted At"];
      const rows = attempts.map((a, idx) =>
        `"${idx + 1}","${a.student_name.replace(/"/g, '""')}","${(a.user_email || "").replace(/"/g, '""')}","${a.college.replace(/"/g, '""')}","${a.batch.replace(/"/g, '""')}","${a.score}","${a.accuracy}%","${a.completed_at}"`
      );
      const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `medtrail_pulse_attempts_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Exported all ${attempts.length} attempts for prize distribution!`);
    } else {
      if (rankingsData.individuals.length === 0) {
        toast.info("No rankings data available to export.");
        return;
      }
      const headers = ["Rank,Doctor Name,Medical College,Batch,Score,Accuracy,Correct Answers,Wrong Answers,Time Taken (s)"];
      const rows = rankingsData.individuals.map((ind) =>
        `"${ind.rank}","${ind.name.replace(/"/g, '""')}","${ind.college.replace(/"/g, '""')}","${ind.batch.replace(/"/g, '""')}","${ind.totalScore}","${ind.accuracy}%","${ind.correctAnswers}","${ind.wrongAnswers}","${ind.timeTakenSeconds}"`
      );
      const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `medtrail_full_leaderboard_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Exported complete leaderboard with ${rankingsData.individuals.length} participants!`);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── 1. HEADER & STATUS BANNER ── */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-56 h-56 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-56 h-56 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold tracking-wider uppercase">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                OFFICIAL RESULT CONTROL DECK
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono">
                <ShieldCheck className="w-3 h-3" />
                Super Admin Clearance
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-3">
              Championship Result & Leaderboard Workflow
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mt-1.5 leading-relaxed">
              Decoupled Result Architecture: Publishing a daily Pulse releases questions for competition, but
              <strong> results and standings remain strictly hidden</strong> until explicitly published here.
            </p>
          </div>

          {/* Quick Refresh */}
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-amber-400" : ""}`} />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>

        {/* ── Status Indicators Bar ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 mt-6 border-t border-slate-800/80">
          {/* Status 1: Result Visibility */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              summary?.resultsPublished
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                : "bg-amber-500/10 border-amber-500/40 text-amber-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  summary?.resultsPublished ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {summary?.resultsPublished ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">Results Visibility</div>
                <div className="text-sm font-black mt-0.5">
                  {summary?.resultsPublished ? "OFFICIALLY PUBLISHED" : "HIDDEN FROM STUDENTS"}
                </div>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                summary?.resultsPublished
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                  : "bg-amber-500/20 border-amber-500/40 text-amber-200"
              }`}
            >
              {summary?.resultsPublished ? "LIVE" : "DRAFT"}
            </span>
          </div>

          {/* Status 2: Leaderboard Freeze */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              summary?.isLeaderboardFrozen
                ? "bg-rose-500/10 border-rose-500/40 text-rose-300"
                : "bg-blue-500/10 border-blue-500/40 text-blue-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  summary?.isLeaderboardFrozen ? "bg-rose-500/20 text-rose-400" : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {summary?.isLeaderboardFrozen ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">Leaderboard Lock</div>
                <div className="text-sm font-black mt-0.5">
                  {summary?.isLeaderboardFrozen ? "FROZEN (IMMUTABLE)" : "LIVE (ACCEPTING SUBMISSIONS)"}
                </div>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                summary?.isLeaderboardFrozen
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-200"
                  : "bg-blue-500/20 border-blue-500/40 text-blue-200"
              }`}
            >
              {summary?.isLeaderboardFrozen ? "LOCKED" : "ACTIVE"}
            </span>
          </div>

          {/* Status 3: Champion Status */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-slate-300">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Crown className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-mono text-slate-400">Projected Champion</div>
                <div className="text-sm font-bold text-white truncate max-w-[150px]">
                  {summary?.rank1Name || "Dr. Samarth Rautrao"}
                </div>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-amber-400">
              {summary?.topScore ? `${summary.topScore} PTS` : "RANK #1"}
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. MASTER ACTIONS DECK ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ACTION CARD 1: PUBLISH / HIDE RESULTS */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider">
                Step 1: Student Exposure
              </span>
              {summary?.resultsPublished ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">
                  CONCEALED
                </span>
              )}
            </div>
            <h3 className="text-lg font-black text-white">Results Visibility</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              When hidden, students only see that their attempt was safely stored. When published, full leaderboards
              and faculty explanations are unlocked.
            </p>
          </div>

          <div className="pt-2">
            {summary?.resultsPublished ? (
              <button
                disabled={isUpdating}
                onClick={() => setShowHideModal(true)}
                className="w-full py-3.5 px-4 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <EyeOff className="w-4 h-4 text-rose-400" />
                <span>Hide Results From Students</span>
              </button>
            ) : (
              <button
                disabled={isUpdating}
                onClick={() => setShowPublishModal(true)}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
              >
                <Eye className="w-4 h-4" />
                <span>Publish Official Results Now</span>
              </button>
            )}
          </div>
        </div>

        {/* ACTION CARD 2: FREEZE / UNFREEZE LEADERBOARD */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                Step 2: Standings Lock
              </span>
              {summary?.isLeaderboardFrozen ? (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                  SEALED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                  LIVE
                </span>
              )}
            </div>
            <h3 className="text-lg font-black text-white">Leaderboard Freeze</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Freeze the leaderboard before finalizing rankings so late attempts or modifications do not shift the
              official podium standings.
            </p>
          </div>

          <div className="pt-2">
            <button
              disabled={isUpdating}
              onClick={handleToggleFreeze}
              className={`w-full py-3.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 border disabled:opacity-50 ${
                summary?.isLeaderboardFrozen
                  ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                  : "bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/40"
              }`}
            >
              {summary?.isLeaderboardFrozen ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              <span>{summary?.isLeaderboardFrozen ? "Unfreeze Standings" : "Freeze Leaderboard"}</span>
            </button>
          </div>
        </div>

        {/* ACTION CARD 3: DECLARE SOVEREIGN CHAMPION */}
        <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                Step 3: Grand Finale
              </span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                PERMANENT
              </span>
            </div>
            <h3 className="text-lg font-black text-white">Declare Official Champion</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Locks all scores, inscribes Rank #1 into the Hall of Fame for Trophy MT-S1-001, and issues digital
              accolades.
            </p>
          </div>

          <div className="pt-2">
            <button
              disabled={isUpdating}
              onClick={() => setShowDeclareModal(true)}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 disabled:opacity-50"
            >
              <Crown className="w-4 h-4 text-slate-950" />
              <span>Declare Official Champion</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 3. METRICS OVERVIEW ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] font-mono text-slate-400">Total Attempts Logged</div>
          <div className="text-2xl font-black text-white">{summary?.totalSubmissions ?? attempts.length}</div>
          <div className="text-[10px] text-emerald-400 font-mono">Verified telemetry records</div>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] font-mono text-slate-400">Average Score</div>
          <div className="text-2xl font-black text-amber-400">{summary?.avgScore ?? 0} PTS</div>
          <div className="text-[10px] text-slate-500 font-mono">Across all colleges</div>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] font-mono text-slate-400">Average Accuracy</div>
          <div className="text-2xl font-black text-emerald-400">{summary?.avgAccuracy ?? 0}%</div>
          <div className="text-[10px] text-slate-500 font-mono">Clinical decision accuracy</div>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] font-mono text-slate-400">Top Recorded Score</div>
          <div className="text-2xl font-black text-blue-400">{summary?.topScore ?? 0} PTS</div>
          <div className="text-[10px] text-slate-500 font-mono">Current leader</div>
        </div>
      </div>

      {/* ── 4. AUDIT & PREVIEW TABS ── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {[
              { id: "attempts", label: `Recorded Submissions (${attempts.length})`, icon: Users },
              { id: "individual", label: "Individual Leaderboard Preview", icon: Trophy },
              { id: "college", label: "College Standings", icon: GraduationCap },
              { id: "batch", label: "MBBS Batch Standings", icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activePreviewTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActivePreviewTab(tab.id as any)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                      : "bg-slate-900 text-slate-400 hover:text-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 hover:border-slate-600 transition cursor-pointer shrink-0"
              title="Export complete participant data for Season 1 Prize Distribution"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Export CSV</span>
            </button>

            {activePreviewTab === "attempts" && (
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search student or college..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* TAB A: ATTEMPTS AUDIT LIST */}
        {activePreviewTab === "attempts" && (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden">
            {filteredAttempts.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center mx-auto text-slate-400">
                  <Users className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">No attempts recorded yet</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  When students participate in today's Pulse, their submissions and anti-tamper telemetry will appear
                  here for administrative verification.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-slate-800 uppercase">
                    <tr>
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Medical College</th>
                      <th className="py-3 px-4">Batch</th>
                      <th className="py-3 px-4 text-center">Score</th>
                      <th className="py-3 px-4 text-center">Accuracy</th>
                      <th className="py-3 px-4 text-right">Submitted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredAttempts.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">#{idx + 1}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{item.student_name}</div>
                          {item.user_email && <div className="text-[10px] text-slate-500 font-mono">{item.user_email}</div>}
                        </td>
                        <td className="py-3 px-4 text-slate-300">{item.college}</td>
                        <td className="py-3 px-4 text-slate-400">{item.batch}</td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-amber-300">+{item.score} PTS</td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-emerald-400">{item.accuracy}%</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400">
                          {new Date(item.completed_at).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB B: INDIVIDUAL LEADERBOARD PREVIEW */}
        {activePreviewTab === "individual" && (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden">
            <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">
                Previewing official standings {summary?.resultsPublished ? "(Currently Live)" : "(Currently Hidden)"}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold">
                {rankingsData.individuals.length} Qualifiers
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-slate-800 uppercase">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Doctor</th>
                    <th className="py-3 px-4">Medical College</th>
                    <th className="py-3 px-4 text-center">Accuracy</th>
                    <th className="py-3 px-4 text-right">Total Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {rankingsData.individuals.map((r) => (
                    <tr key={r.participantId} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">#{r.rank}</td>
                      <td className="py-3 px-4 font-semibold text-white">{r.name}</td>
                      <td className="py-3 px-4 text-slate-300">{r.college}</td>
                      <td className="py-3 px-4 text-center font-mono text-emerald-400">{r.accuracy}%</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {r.totalScore.toLocaleString()} PTS
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB C: COLLEGE RANKINGS PREVIEW */}
        {activePreviewTab === "college" && (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-slate-800 uppercase">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Medical College</th>
                    <th className="py-3 px-4 text-center">Participants</th>
                    <th className="py-3 px-4 text-center">Avg Accuracy</th>
                    <th className="py-3 px-4 text-right">Aggregate Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {rankingsData.collegeRankings.map((c) => (
                    <tr key={c.college} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">#{c.rank}</td>
                      <td className="py-3 px-4 font-semibold text-white">{c.college}</td>
                      <td className="py-3 px-4 text-center font-mono text-slate-300">{c.participantsCount}</td>
                      <td className="py-3 px-4 text-center font-mono text-emerald-400">{c.avgAccuracy}%</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {c.totalScore.toLocaleString()} PTS
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB D: BATCH RANKINGS PREVIEW */}
        {activePreviewTab === "batch" && (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-slate-800 uppercase">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">MBBS Batch</th>
                    <th className="py-3 px-4 text-center">Enrolled</th>
                    <th className="py-3 px-4 text-right">Aggregate Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {rankingsData.batchRankings.map((b) => (
                    <tr key={b.batch} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">#{b.rank}</td>
                      <td className="py-3 px-4 font-semibold text-white">{b.batch}</td>
                      <td className="py-3 px-4 text-center font-mono text-slate-300">{b.participantsCount}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {b.totalScore.toLocaleString()} PTS
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL 1: PUBLISH RESULTS CONFIRMATION ── */}
      {showPublishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-emerald-500/40 p-6 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Eye className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Publish Official Results?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This will immediately expose the official leaderboard, individual student rankings, and faculty
                explanations across all student applications.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Attempts Logged:</span>
                <span className="font-mono text-white font-bold">{attempts.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Leading Participant:</span>
                <span className="font-mono text-amber-400 font-bold">{summary?.rank1Name || "Top Rank"}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={isUpdating}
                onClick={() => handleToggleResults(true)}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-emerald-600/30 disabled:opacity-50"
              >
                {isUpdating ? "Publishing..." : "Yes, Publish Results"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: HIDE RESULTS CONFIRMATION ── */}
      {showHideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-rose-500/40 p-6 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <EyeOff className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Hide Results from Students?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This will conceal the official leaderboard, rankings, and faculty solutions. Students will see the
                "Results Awaiting Publication" screen.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowHideModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={isUpdating}
                onClick={() => handleToggleResults(false)}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-rose-600/30 disabled:opacity-50"
              >
                {isUpdating ? "Hiding..." : "Yes, Hide Results"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: DECLARE CHAMPION CONFIRMATION ── */}
      {showDeclareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/40 p-6 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Crown className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-black text-white">Declare Sovereign Champion</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This seals the Season 1 competition: freezes the leaderboard, publishes final results, inscribes the
                Rank #1 winner into the permanent Hall of Fame for the Obsidian Trophy, and sends broadcast push
                notifications.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-mono text-amber-300">
                Type <strong>CONFIRM</strong> to declare final champion:
              </label>
              <input
                type="text"
                value={declareConfirmText}
                onChange={(e) => setDeclareConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 font-mono text-xs text-white uppercase placeholder-slate-600 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowDeclareModal(false);
                  setDeclareConfirmText("");
                }}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={isUpdating || declareConfirmText.trim().toUpperCase() !== "CONFIRM"}
                onClick={handleConfirmDeclareChampion}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black uppercase transition cursor-pointer shadow-lg shadow-amber-500/25 disabled:opacity-40"
              >
                {isUpdating ? "Finalizing..." : "Declare Winner"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
