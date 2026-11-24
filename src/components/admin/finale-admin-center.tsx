import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Crown,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Award,
  Flame,
  RefreshCw,
  Play,
  Pause,
  Lock,
  Unlock,
  FileText,
  Eye,
  Send,
  Check,
  X,
  ChevronRight,
  Calendar,
  Zap,
  BarChart3,
  UserCheck,
  UserX,
  Radio,
  History,
  AlertCircle,
  Hash,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { isSuperAdminEmail } from "@/lib/super-admin-service";
import {
  fetchFinaleLiveOpsSummary,
  fetchFinaleDays,
  fetchFinaleRoster,
  fetchFinaleRosterMeta,
  fetchFinaleQuestions,
  fetchFinaleSessions,
  fetchFinaleResults,
  fetchPendingApprovals,
  fetchFinaleApprovals,
  fetchFinaleAuditLogs,
  fetchFinaleTelemetry,
  adminRejectApproval,
  requestSealRosterApproval,
  requestPromoteReserveApproval,
  requestVoidAndReissueSessionApproval,
  requestPublishDailyResultsApproval,
  requestDeclareFinalWinnerApproval,
  executeSealRoster,
  executePromoteReserve,
  executeVoidAndReissueSession,
  executePublishDailyResults,
  executeDeclareFinalWinner,
  toggleEmergencyPause,
  reconcileFinaleDayScores,
  subscribeToFinaleDays,
  subscribeToFinaleApprovals,
  subscribeToFinaleSessions,
  type FinaleLiveOpsSummary,
  type FinaleDay,
  type FinaleRosterSeat,
  type FinaleRosterMeta,
  type FinaleQuestion,
  type FinaleSession,
  type FinaleResult,
  type FinaleAdminApproval,
  type FinaleAuditLogEntry,
  type FinaleTelemetryEntry,
  type FinaleReconciliationResult,
} from "@/lib/finale-admin-service";

export function FinaleAdminCenter() {
  const { user } = useAuth();
  const isSuperAdmin = user ? isSuperAdminEmail(user.email) : false;

  // Active Sub-Tab
  const [activeTab, setActiveTab] = useState<
    "overview" | "roster" | "questions" | "schedule" | "approvals" | "live_sessions" | "results"
  >("overview");

  // Core Data States
  const [summary, setSummary] = useState<FinaleLiveOpsSummary | null>(null);
  const [days, setDays] = useState<FinaleDay[]>([]);
  const [roster, setRoster] = useState<FinaleRosterSeat[]>([]);
  const [rosterMeta, setRosterMeta] = useState<FinaleRosterMeta | null>(null);
  const [questions, setQuestions] = useState<FinaleQuestion[]>([]);
  const [sessions, setSessions] = useState<FinaleSession[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<FinaleAdminApproval[]>([]);
  const [allApprovals, setAllApprovals] = useState<FinaleAdminApproval[]>([]);
  const [dailyResults, setDailyResults] = useState<FinaleResult[]>([]);
  const [cumulativeResults, setCumulativeResults] = useState<FinaleResult[]>([]);
  const [auditLogs, setAuditLogs] = useState<FinaleAuditLogEntry[]>([]);
  const [telemetry, setTelemetry] = useState<FinaleTelemetryEntry[]>([]);

  // Sub-filter states
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Operational Action States
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);
  const [rejectionModalApprovalId, setRejectionModalApprovalId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>("");

  // Reserve Promotion Dialog State
  const [showPromoteModal, setShowPromoteModal] = useState<boolean>(false);
  const [promoteReserveSeat, setPromoteReserveSeat] = useState<number>(1);
  const [withdrawingSeat, setWithdrawingSeat] = useState<number>(1);
  const [promoteReason, setPromoteReason] = useState<string>("");

  // Void & Reissue Dialog State
  const [voidSessionId, setVoidSessionId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState<string>("");

  // Score Reconciliation Result State
  const [reconResult, setReconResult] = useState<FinaleReconciliationResult | null>(null);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);

  // ── 1. Comprehensive Data Loading ───────────────────────────────────────────
  const loadAllData = useCallback(async (silent: boolean = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const [
        sumRes,
        daysRes,
        rosterRes,
        rosterMetaRes,
        questionsRes,
        sessionsRes,
        pendingApprRes,
        allApprRes,
        dailyRes,
        cumRes,
        auditRes,
        teleRes,
      ] = await Promise.all([
        fetchFinaleLiveOpsSummary(),
        fetchFinaleDays(),
        fetchFinaleRoster(),
        fetchFinaleRosterMeta(),
        fetchFinaleQuestions(),
        fetchFinaleSessions(),
        fetchPendingApprovals(),
        fetchFinaleApprovals(),
        fetchFinaleResults("daily"),
        fetchFinaleResults("cumulative"),
        fetchFinaleAuditLogs(20),
        fetchFinaleTelemetry(undefined, 50),
      ]);

      if (sumRes.data) setSummary(sumRes.data);
      if (daysRes.data) setDays(daysRes.data);
      if (rosterRes.data) setRoster(rosterRes.data);
      if (rosterMetaRes.data) setRosterMeta(rosterMetaRes.data);
      if (questionsRes.data) setQuestions(questionsRes.data);
      if (sessionsRes.data) setSessions(sessionsRes.data);
      if (pendingApprRes.data) setPendingApprovals(pendingApprRes.data);
      if (allApprRes.data) setAllApprovals(allApprRes.data);
      if (dailyRes.data) setDailyResults(dailyRes.data);
      if (cumRes.data) setCumulativeResults(cumRes.data);
      if (auditRes.data) setAuditLogs(auditRes.data);
      if (teleRes.data) setTelemetry(teleRes.data);
    } catch (err: any) {
      console.error("[FinaleAdmin] Load error:", err);
      toast.error("Failed to sync Grand Finale data: " + err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();

    // Attach Realtime Subscriptions with Safe Cleanups
    const unsubDays = subscribeToFinaleDays(() => loadAllData(true));
    const unsubApprovals = subscribeToFinaleApprovals(() => loadAllData(true));
    const unsubSessions = subscribeToFinaleSessions(() => loadAllData(true));

    return () => {
      unsubDays();
      unsubApprovals();
      unsubSessions();
    };
  }, [loadAllData]);

  // Filtered Questions by Day
  const currentDayQuestions = useMemo(() => {
    return questions.filter((q) => q.day_number === selectedDayNumber);
  }, [questions, selectedDayNumber]);

  // Filtered Sessions by Day
  const currentDaySessions = useMemo(() => {
    return sessions.filter((s) => s.day_number === selectedDayNumber);
  }, [sessions, selectedDayNumber]);

  // Current Selected Day Record
  const currentDay = useMemo(() => {
    return days.find((d) => d.day_number === selectedDayNumber) || null;
  }, [days, selectedDayNumber]);

  // ── 2. Action Handlers: Approvals (Initiator Step 1) ─────────────────────────
  const handleRequestSealRoster = async () => {
    if (!window.confirm("Initiate Dual-Approval request to SEAL the Finalist Roster and 30-Question Bank?")) return;
    setIsSubmittingAction(true);
    try {
      const res = await requestSealRosterApproval("Official sealing of Season 1 Grand Finale Roster");
      if (res.success) {
        toast.success("Approval requested for SEAL_ROSTER. Second Super Admin authorization is now required.");
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to request roster seal approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRequestPromoteReserve = async () => {
    if (!promoteReason || promoteReason.trim().length < 5) {
      toast.error("Please provide a documented reason (min 5 characters).");
      return;
    }
    setIsSubmittingAction(true);
    try {
      const res = await requestPromoteReserveApproval(promoteReserveSeat, withdrawingSeat, promoteReason);
      if (res.success) {
        toast.success(`Approval requested to promote Reserve #${promoteReserveSeat} to Seat #${withdrawingSeat}`);
        setShowPromoteModal(false);
        setPromoteReason("");
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to request reserve promotion approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRequestVoidSession = async () => {
    if (!voidSessionId) return;
    if (!voidReason || voidReason.trim().length < 5) {
      toast.error("Please provide a documented justification for voiding this session (min 5 characters).");
      return;
    }
    setIsSubmittingAction(true);
    try {
      const res = await requestVoidAndReissueSessionApproval(voidSessionId, voidReason);
      if (res.success) {
        toast.success("Approval requested to VOID and REISSUE session. Second Super Admin authorization required.");
        setVoidSessionId(null);
        setVoidReason("");
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to request session void approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRequestPublishDailyResults = async (dayNum: number) => {
    if (!window.confirm(`Initiate Dual-Approval request to PUBLISH Day ${dayNum} official results? This will unseal solutions.`)) return;
    setIsSubmittingAction(true);
    try {
      const res = await requestPublishDailyResultsApproval(dayNum, `Publishing official results for Day ${dayNum}`);
      if (res.success) {
        toast.success(`Approval requested for PUBLISH_DAILY_RESULTS (Day ${dayNum}). Awaiting second authorization.`);
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to request results publication approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRequestDeclareWinner = async () => {
    if (!window.confirm("Initiate Dual-Approval request to DECLARE the Grand Finale Champion and finalize cumulative standings?")) return;
    setIsSubmittingAction(true);
    try {
      const res = await requestDeclareFinalWinnerApproval("Sovereign Champion Declaration and Hall of Fame Inscription");
      if (res.success) {
        toast.success("Approval requested for DECLARE_FINAL_WINNER. Second Super Admin authorization required.");
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to request winner declaration approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ── 3. Action Handlers: Second-Admin Execution (Step 2) ─────────────────────
  const handleExecuteApproval = async (approval: FinaleAdminApproval) => {
    if (!user) {
      toast.error("You must be authenticated to execute an approval.");
      return;
    }

    if (approval.first_approver_id === user.id) {
      toast.error("Dual-Control Violation: You initiated this request. A distinct Second Super Administrator must authorize and execute it.");
      return;
    }

    if (!isSuperAdmin) {
      toast.error("Execution of irreversible Grand Finale actions requires verified Super Admin clearance.");
      return;
    }

    if (!window.confirm(`Authorize and execute ${approval.action_name} as Second Super Administrator?`)) return;

    setIsSubmittingAction(true);
    try {
      let res;
      switch (approval.action_name) {
        case "SEAL_ROSTER":
          res = await executeSealRoster(approval.id);
          break;
        case "PROMOTE_RESERVE":
          res = await executePromoteReserve(approval.id);
          break;
        case "VOID_AND_REISSUE_SESSION":
          res = await executeVoidAndReissueSession(approval.id);
          break;
        case "PUBLISH_DAILY_RESULTS":
          res = await executePublishDailyResults(approval.id);
          break;
        case "DECLARE_FINAL_WINNER":
          res = await executeDeclareFinalWinner(approval.id);
          break;
        default:
          toast.error("Unknown approval action: " + (approval as any).action_name);
          return;
      }

      if (res.success) {
        toast.success(`Successfully authorized and executed ${approval.action_name}!`);
        loadAllData(true);
      } else {
        toast.error(res.error || `Failed to execute ${approval.action_name}`);
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRejectApproval = async () => {
    if (!rejectionModalApprovalId) return;
    if (!rejectionReason || rejectionReason.trim().length < 5) {
      toast.error("Please enter a rejection reason (min 5 characters).");
      return;
    }

    setIsSubmittingAction(true);
    try {
      const res = await adminRejectApproval(rejectionModalApprovalId, rejectionReason);
      if (res.success) {
        toast.info("Approval request rejected and cancelled.");
        setRejectionModalApprovalId(null);
        setRejectionReason("");
        loadAllData(true);
      } else {
        toast.error(res.error || "Failed to reject approval");
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ── 4. Direct Operational Action Handlers ────────────────────────────────────
  const handleTogglePause = async (dayNumber: number, shouldPause: boolean) => {
    const actionName = shouldPause ? "EMERGENCY PAUSE" : "RESUME";
    if (!window.confirm(`Are you sure you want to ${actionName} Day ${dayNumber}?`)) return;

    setIsSubmittingAction(true);
    try {
      const res = await toggleEmergencyPause(dayNumber, shouldPause);
      if (res.success) {
        toast.success(`Day ${dayNumber} successfully set to: ${res.data?.status?.toUpperCase()}`);
        loadAllData(true);
      } else {
        toast.error(res.error || `Failed to ${actionName.toLowerCase()} Day ${dayNumber}`);
      }
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRunReconciliation = async (dayNum: number) => {
    setIsReconciling(true);
    try {
      const res = await reconcileFinaleDayScores(dayNum);
      if (res.success && res.data) {
        setReconResult(res.data);
        if (res.data.discrepancies.length === 0) {
          toast.success(`Reconciliation complete for Day ${dayNum}: Zero discrepancies detected! (${res.data.clean_sessions} sessions verified clean)`);
        } else {
          toast.warning(`Reconciliation finished with ${res.data.discrepancies.length} discrepancy record(s) flagged.`);
        }
      } else {
        toast.error(res.error || "Failed to run score reconciliation");
      }
    } finally {
      setIsReconciling(false);
    }
  };

  // ── 5. Render Loading State ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-8 space-y-4">
        <div className="size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p className="font-mono text-xs text-slate-400 uppercase tracking-widest">
          Loading Grand Finale Command Telemetry...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── TOP HEADER & TELEMETRY SYNC ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-950 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[11px] font-bold uppercase tracking-wider">
            <Crown className="size-3.5 text-amber-400" />
            Season 1 Grand Finale Control Deck
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            PULSE FINAL Operations Center
          </h1>
          <p className="text-xs text-slate-400">
            Authoritative command console for 3-day scheduling, dual-admin approvals, roster sealing, and results reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            disabled={isRefreshing}
            onClick={() => loadAllData(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 text-amber-400 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>
      </div>

      {/* ── SUB-NAVIGATION TABS ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {[
          { id: "overview", label: "Dashboard Overview", icon: BarChart3 },
          { id: "roster", label: `Finalists (${roster.length}/12)`, icon: Users },
          { id: "questions", label: `Question Bank (${questions.length}/30)`, icon: FileText },
          { id: "schedule", label: "Schedule & Emergency Ops", icon: Calendar },
          { id: "approvals", label: `Dual Approvals (${pendingApprovals.length} Pending)`, icon: ShieldCheck, badge: pendingApprovals.length > 0 },
          { id: "live_sessions", label: `Live Sessions (${sessions.filter((s) => s.status === "active").length} Active)`, icon: Radio },
          { id: "results", label: "Results & Winner Declaration", icon: Award },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition cursor-pointer relative ${
                isActive
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25"
                  : "bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800"
              }`}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span className="text-[11px] font-mono text-slate-400">Roster Sealing Status</span>
              <div className="flex items-center gap-2">
                {rosterMeta?.is_sealed ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
                    <ShieldCheck className="size-4" /> Sealed & Cryptographically Locked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-bold text-sm">
                    <Lock className="size-4" /> Unsealed (Pending Dual Authorization)
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {rosterMeta?.is_sealed ? `Sealed on ${new Date(rosterMeta.sealed_at!).toLocaleDateString("en-IN")}` : "Requires dual-admin approval to seal"}
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span className="text-[11px] font-mono text-slate-400">Roster Cardinality</span>
              <div className="text-xl font-black text-white">
                {summary?.finalistsCount ?? 0} Finalists / {summary?.reservesCount ?? 0} Reserves
              </div>
              <p className="text-[10px] text-emerald-400">
                12 Verified Seats Assigned
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span className="text-[11px] font-mono text-slate-400">Question Bank</span>
              <div className="text-xl font-black text-white">
                {questions.length} / 30 Questions
              </div>
              <p className="text-[10px] text-slate-400">
                {questions.length === 30 ? "Complete (10 per day)" : "Incomplete question set"}
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span className="text-[11px] font-mono text-slate-400">Pending Approvals</span>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-black ${pendingApprovals.length > 0 ? "text-rose-400" : "text-slate-200"}`}>
                  {pendingApprovals.length}
                </span>
                {pendingApprovals.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] font-bold">
                    Action Required
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                Awaiting second-admin authorization
              </p>
            </div>
          </div>

          {/* 3-Day Competition Status Cards */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              3-Day Competition Windows
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {days.map((d) => (
                <div key={d.day_number} className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                      Day {d.day_number}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        d.status === "open"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : d.status === "paused"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : d.status === "results_published"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="text-slate-300 font-medium">{d.competition_date}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {new Date(d.window_opens_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} –{" "}
                      {new Date(d.window_closes_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">Results Published:</span>
                    <span className={`font-mono font-bold ${d.results_published ? "text-emerald-400" : "text-slate-500"}`}>
                      {d.results_published ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="p-6 rounded-3xl bg-slate-950 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Quick Administrative Actions
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                disabled={isSubmittingAction || rosterMeta?.is_sealed}
                onClick={handleRequestSealRoster}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-left transition cursor-pointer space-y-1 disabled:opacity-50"
              >
                <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                  <span>Initiate Roster Sealing</span>
                  <Lock className="size-4" />
                </div>
                <p className="text-[11px] text-slate-400">
                  {rosterMeta?.is_sealed ? "Roster is already sealed" : "Validates 12 seats and submits dual approval"}
                </p>
              </button>

              <button
                onClick={() => {
                  setActiveTab("approvals");
                }}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-blue-500/50 text-left transition cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-bold text-blue-400">
                  <span>Review Approvals Queue</span>
                  <ShieldCheck className="size-4" />
                </div>
                <p className="text-[11px] text-slate-400">
                  {pendingApprovals.length} pending requests awaiting authorization
                </p>
              </button>

              <button
                onClick={() => {
                  setActiveTab("results");
                }}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 text-left transition cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-bold text-purple-400">
                  <span>Score Reconciliation</span>
                  <Award className="size-4" />
                </div>
                <p className="text-[11px] text-slate-400">
                  Verify session states against master keys
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: ROSTER MANAGEMENT ── */}
      {activeTab === "roster" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Grand Finale Sealed Roster</h2>
              <p className="text-xs text-slate-400">
                10 Finalists + 2 Reserves verified for the 3-Day Grand Finale.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!rosterMeta?.is_sealed && (
                <button
                  disabled={isSubmittingAction}
                  onClick={handleRequestSealRoster}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer disabled:opacity-50"
                >
                  <Lock className="size-3.5" />
                  <span>Request Seal Roster Approval</span>
                </button>
              )}

              <button
                onClick={() => setShowPromoteModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer"
              >
                <UserCheck className="size-3.5 text-blue-400" />
                <span>Promote Reserve</span>
              </button>
            </div>
          </div>

          {/* Roster Seal Status Card */}
          {rosterMeta?.is_sealed ? (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs font-mono">
                <ShieldCheck className="size-4" />
                OFFICIAL ROSTER & QUESTION BANK SEALED
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                <div>Roster Digest: <span className="text-slate-200">{rosterMeta.roster_hash || "N/A"}</span></div>
                <div>Questions Digest: <span className="text-slate-200">{rosterMeta.questions_hash || "N/A"}</span></div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-amber-300 font-medium">
                <AlertTriangle className="size-4" />
                Roster is unsealed. Modifications allowed until dual-admin sealing lock is executed.
              </div>
            </div>
          )}

          {/* Roster Table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Seat</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Contestant</th>
                    <th className="py-3 px-4">College</th>
                    <th className="py-3 px-4">Batch</th>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Verification</th>
                    <th className="py-3 px-4">Attendance</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {roster.map((seat) => (
                    <tr key={seat.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">
                        #{seat.seat_number}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                            seat.seat_type === "finalist"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          }`}
                        >
                          {seat.seat_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {seat.student_name}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {seat.college}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {seat.batch}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        #{seat.qualification_rank}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3" /> Verified
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {seat.attendance_confirmed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                            <Check className="size-3" /> Confirmed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                            <X className="size-3" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {seat.participation_status === "promoted" ? (
                          <span className="text-blue-400">Promoted to Seat #{seat.promoted_to_seat}</span>
                        ) : (
                          <span className="text-slate-300">{seat.participation_status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {roster.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        No roster seats found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: QUESTION BANK ── */}
      {activeTab === "questions" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Grand Finale Master Question Bank</h2>
              <p className="text-xs text-slate-400">
                Authorized view of the 30 continuous examination prompts across all 3 competition days.
              </p>
            </div>

            {/* Day Selector */}
            <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-2xl border border-slate-800">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDayNumber(d)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    selectedDayNumber === d
                      ? "bg-amber-500 text-slate-950 shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Day {d} (10 Questions)
                </button>
              ))}
            </div>
          </div>

          {/* Security & Access Notice */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
            <div className="flex items-center gap-2 text-amber-400 font-bold font-mono">
              <ShieldAlert className="size-4" />
              Question Bank Security Architecture
            </div>
            <p className="text-slate-400 leading-relaxed">
              Direct table mutations on <code className="text-amber-300">championship_finale_questions</code> are revoked from all client roles. Correct answers and explanations are protected from contestants until daily results are published via dual approval.
            </p>
          </div>

          {/* Questions Grid */}
          <div className="space-y-4">
            {currentDayQuestions.map((q) => (
              <div key={q.id} className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-xs font-bold">
                    Day {q.day_number} • Slot #{q.slot_number}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    Points: <strong className="text-white">+100</strong>
                  </span>
                </div>

                <div className="text-sm font-semibold text-white leading-relaxed">
                  {q.question_text}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  {[
                    { opt: "A", text: q.option_a },
                    { opt: "B", text: q.option_b },
                    { opt: "C", text: q.option_c },
                    { opt: "D", text: q.option_d },
                  ].map(({ opt, text }) => {
                    const isCorrect = q.correct_option === opt;
                    return (
                      <div
                        key={opt}
                        className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                          isCorrect
                            ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                            : "bg-slate-950 border-slate-800 text-slate-300"
                        }`}
                      >
                        <span className={`font-mono font-bold ${isCorrect ? "text-emerald-400" : "text-slate-500"}`}>
                          {opt}.
                        </span>
                        <span>{text}</span>
                        {isCorrect && (
                          <CheckCircle2 className="size-3.5 text-emerald-400 ml-auto shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400">
                    <strong className="text-slate-300 font-mono">Explanation:</strong> {q.explanation}
                  </div>
                )}
              </div>
            ))}

            {currentDayQuestions.length === 0 && (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                No questions recorded for Day {selectedDayNumber}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: SCHEDULE & OPERATIONS ── */}
      {activeTab === "schedule" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-black text-white">Competition Windows & Emergency Operations</h2>
            <p className="text-xs text-slate-400">
              Live operational controls for November 24, 25, 26, 2026 daily 7:00 PM – 8:00 PM IST windows.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {days.map((d) => {
              const isPaused = d.status === "paused";
              const isOpen = d.status === "open";
              return (
                <div key={d.day_number} className="p-6 rounded-3xl bg-slate-950 border border-slate-800 space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                        Day {d.day_number}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase ${
                          isOpen
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : isPaused
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-base font-bold text-white">{d.competition_date}</div>
                      <div className="text-xs font-mono text-slate-400">
                        {new Date(d.window_opens_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} –{" "}
                        {new Date(d.window_closes_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-1 font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span>Duration Limit:</span>
                        <span className="text-white">90.000s Continuous</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Results Published:</span>
                        <span className={d.results_published ? "text-emerald-400" : "text-slate-500"}>
                          {d.results_published ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Operational Controls */}
                  <div className="pt-2 space-y-2">
                    {isOpen ? (
                      <button
                        disabled={isSubmittingAction}
                        onClick={() => handleTogglePause(d.day_number, true)}
                        className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 disabled:opacity-50"
                      >
                        <Pause className="size-4" />
                        <span>Emergency Pause</span>
                      </button>
                    ) : isPaused ? (
                      <button
                        disabled={isSubmittingAction}
                        onClick={() => handleTogglePause(d.day_number, false)}
                        className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Play className="size-4" />
                        <span>Resume Competition</span>
                      </button>
                    ) : (
                      <div className="py-2.5 px-4 rounded-xl bg-slate-900 text-slate-500 text-center font-mono text-xs">
                        Emergency pause available during live open window
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 5: DUAL-ADMIN APPROVALS ── */}
      {activeTab === "approvals" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Dual Administrative Approval Queue</h2>
              <p className="text-xs text-slate-400">
                Two-person authorization protocol. Irreversible actions require initiation by Admin 1 and authorization by Admin 2.
              </p>
            </div>
          </div>

          {/* Pending Approvals Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
              Pending Authorization ({pendingApprovals.length})
            </h3>

            {pendingApprovals.length === 0 && (
              <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-slate-500 font-mono text-xs">
                No approvals currently pending.
              </div>
            )}

            <div className="space-y-4">
              {pendingApprovals.map((appr) => {
                const isInitiator = user ? appr.first_approver_id === user.id : false;
                const isExpired = new Date(appr.expires_at) < new Date();
                return (
                  <div key={appr.id} className="p-5 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-4 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-bold uppercase">
                          {appr.action_name}
                        </span>
                        {appr.target_day && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[11px]">
                            Day {appr.target_day}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[10px] uppercase font-bold">
                          Pending
                        </span>
                      </div>

                      <div className="font-mono text-xs text-slate-400 flex items-center gap-1.5">
                        <Clock className="size-3.5 text-amber-400" />
                        Expires: {new Date(appr.expires_at).toLocaleTimeString("en-IN")}
                      </div>
                    </div>

                    {/* Payload Details */}
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs font-mono">
                      <div className="text-slate-400">
                        Payload Hash: <span className="text-slate-200">{appr.payload_hash}</span>
                      </div>
                      <div className="text-slate-400">
                        Initiator ID: <span className="text-slate-200">{appr.first_approver_id}</span>
                      </div>
                      {appr.payload && (
                        <div className="text-slate-400">
                          Bound Payload:{" "}
                          <pre className="mt-1 p-2 rounded bg-slate-950 text-[11px] text-slate-300 overflow-x-auto">
                            {JSON.stringify(appr.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Dual-Control Restriction Enforcement Notice */}
                    {isInitiator && (
                      <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-300">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span>
                          <strong>Dual-Control Enforcement:</strong> You initiated this request. A distinct Second Super Administrator must authorize and execute it.
                        </span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800/80">
                      <button
                        disabled={isSubmittingAction}
                        onClick={() => {
                          setRejectionModalApprovalId(appr.id);
                          setRejectionReason("");
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
                      >
                        Reject Request
                      </button>

                      <button
                        disabled={isSubmittingAction || isInitiator || isExpired}
                        onClick={() => handleExecuteApproval(appr)}
                        className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-500/25 cursor-pointer disabled:opacity-50"
                      >
                        Authorize & Execute as Second Admin
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical Approvals Table */}
          <div className="space-y-3 pt-6">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
              Approval History (Resolved)
            </h3>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Day</th>
                      <th className="py-3 px-4">Initiated</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Second Approver</th>
                      <th className="py-3 px-4">Executed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans font-mono text-[11px]">
                    {allApprovals
                      .filter((a) => a.status !== "pending")
                      .map((a) => (
                        <tr key={a.id} className="hover:bg-slate-800/30 transition">
                          <td className="py-3 px-4 font-bold text-white font-sans">{a.action_name}</td>
                          <td className="py-3 px-4 text-slate-400">{a.target_day ? `Day ${a.target_day}` : "—"}</td>
                          <td className="py-3 px-4 text-slate-400">{new Date(a.first_approved_at).toLocaleTimeString("en-IN")}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                a.status === "executed"
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : a.status === "rejected"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {a.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-400">{a.second_approver_id || "—"}</td>
                          <td className="py-3 px-4 text-slate-400">{a.executed_at ? new Date(a.executed_at).toLocaleTimeString("en-IN") : "—"}</td>
                        </tr>
                      ))}
                    {allApprovals.filter((a) => a.status !== "pending").length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                          No historical approval logs found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: LIVE SESSIONS & PROCTORING ── */}
      {activeTab === "live_sessions" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Live Contestant Sessions & Proctoring</h2>
              <p className="text-xs text-slate-400">
                Continuous 90.000s countdown monitoring and anomaly detection.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDayNumber(d)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    selectedDayNumber === d ? "bg-amber-500 text-slate-950 font-bold" : "bg-slate-900 text-slate-400"
                  }`}
                >
                  Day {d}
                </button>
              ))}
            </div>
          </div>

          {/* Sessions Table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Seat</th>
                    <th className="py-3 px-4">Contestant</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Current Slot</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Elapsed Time</th>
                    <th className="py-3 px-4">Started At</th>
                    <th className="py-3 px-4">Reissued</th>
                    <th className="py-3 px-4 text-right">Intervention</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {currentDaySessions.map((sess) => (
                    <tr key={sess.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">
                        #{sess.seat_number ?? "—"}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {sess.student_name ?? sess.user_id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                            sess.status === "active"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : sess.status === "completed"
                              ? "bg-blue-500/20 text-blue-300"
                              : sess.status === "voided"
                              ? "bg-rose-500/20 text-rose-300"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {sess.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        Slot {sess.current_slot}/10
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">
                        {sess.total_score} PTS
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {Number(sess.total_time_seconds).toFixed(2)}s
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                        {new Date(sess.started_at).toLocaleTimeString("en-IN")}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {sess.is_reissued ? "Yes" : "No"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {sess.status !== "voided" && (
                          <button
                            onClick={() => {
                              setVoidSessionId(sess.id);
                              setVoidReason("");
                            }}
                            className="px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-bold text-[11px] transition cursor-pointer"
                          >
                            Void & Reissue
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {currentDaySessions.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        No examination sessions started for Day {selectedDayNumber}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Telemetry Proctoring Stream */}
          <div className="space-y-3 pt-4">
            <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Radio className="size-3.5 text-amber-400 animate-pulse" />
              Recent Proctoring Telemetry Feed
            </h3>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 max-h-64 overflow-y-auto space-y-2 font-mono text-[11px]">
              {telemetry.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        t.event_type === "window_blur" || t.event_type === "visibility_hidden"
                          ? "bg-rose-500/20 text-rose-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {t.event_type}
                    </span>
                    <span className="text-slate-300">Session: {t.session_id.slice(0, 8)}</span>
                  </div>
                  <span className="text-slate-500">
                    {new Date(t.server_timestamp).toLocaleTimeString("en-IN")}
                  </span>
                </div>
              ))}
              {telemetry.length === 0 && (
                <div className="text-center text-slate-500 py-4 font-sans">
                  No telemetry anomalies recorded.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 7: RESULTS & WINNER DECLARATION ── */}
      {activeTab === "results" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Score Reconciliation & Result Publication</h2>
              <p className="text-xs text-slate-400">
                Cross-verify session states, publish official daily standings, and inscribe the sovereign champion.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={isReconciling}
                onClick={() => handleRunReconciliation(selectedDayNumber)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer"
              >
                <RefreshCw className={`size-3.5 text-amber-400 ${isReconciling ? "animate-spin" : ""}`} />
                <span>Reconcile Day {selectedDayNumber} Scores</span>
              </button>

              <button
                disabled={isSubmittingAction || currentDay?.results_published}
                onClick={() => handleRequestPublishDailyResults(selectedDayNumber)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer disabled:opacity-50"
              >
                <Award className="size-3.5" />
                <span>Request Publish Day {selectedDayNumber}</span>
              </button>

              <button
                disabled={isSubmittingAction}
                onClick={handleRequestDeclareWinner}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                <Crown className="size-3.5 text-slate-950" />
                <span>Declare Final Winner</span>
              </button>
            </div>
          </div>

          {/* Reconciliation Output Box */}
          {reconResult && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="font-bold text-white">Reconciliation Report (Day {reconResult.day_number})</span>
                <span className="text-slate-400">
                  Clean: <strong className="text-emerald-400">{reconResult.clean_sessions}</strong> / Total: {reconResult.total_sessions}
                </span>
              </div>
              {reconResult.discrepancies.length > 0 ? (
                <div className="space-y-1 text-xs font-mono text-rose-300">
                  {reconResult.discrepancies.map((d, i) => (
                    <div key={i} className="p-2 rounded bg-rose-950/30 border border-rose-500/30">
                      Session {d.session_id.slice(0, 8)}: Cached {d.cached_score} PTS vs Verified {d.verified_score} PTS ({d.discrepancy_types.join(", ")})
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="size-4" /> All sessions match question bank keys with 100% mathematical integrity.
                </div>
              )}
            </div>
          )}

          {/* Cumulative 3-Day Standings Table */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
              Cumulative 3-Day Grand Finale Leaderboard
            </h3>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">Seat</th>
                      <th className="py-3 px-4">Contestant</th>
                      <th className="py-3 px-4">College</th>
                      <th className="py-3 px-4">Total Score</th>
                      <th className="py-3 px-4">Total Time</th>
                      <th className="py-3 px-4">Day 1</th>
                      <th className="py-3 px-4">Day 2</th>
                      <th className="py-3 px-4">Day 3</th>
                      <th className="py-3 px-4">Winner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {cumulativeResults.map((res) => (
                      <tr key={res.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">
                          #{res.rank}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          #{res.seat_number}
                        </td>
                        <td className="py-3 px-4 font-bold text-white">
                          {res.student_name}
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {res.college}
                        </td>
                        <td className="py-3 px-4 font-mono font-black text-amber-400 text-sm">
                          {res.score} PTS
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {Number(res.elapsed_time_seconds).toFixed(2)}s
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {res.day1_score ?? "—"}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {res.day2_score ?? "—"}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {res.day3_score ?? "—"}
                        </td>
                        <td className="py-3 px-4">
                          {res.is_winner ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-bold">
                              <Crown className="size-3.5 text-amber-400" /> Champion
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {cumulativeResults.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-500">
                          Cumulative standings will be materialized upon conclusion and publication of all 3 competition days.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 1: REJECTION REASON ── */}
      {rejectionModalApprovalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="max-w-md w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Reject Approval Request</h3>
            <p className="text-xs text-slate-400">
              Document the reason for cancellation. This will be permanently recorded in the immutable audit log.
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Minimum 5 characters describing reason for rejection..."
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRejectionModalApprovalId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectApproval}
                disabled={isSubmittingAction || rejectionReason.trim().length < 5}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: PROMOTE RESERVE ── */}
      {showPromoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="max-w-md w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Promote Reserve Contestant</h3>
            <p className="text-xs text-slate-400">
              Submit a dual-approval request to seat a verified reserve in place of a withdrawing finalist.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Select Reserve Contestant:</label>
                <select
                  value={promoteReserveSeat}
                  onChange={(e) => setPromoteReserveSeat(Number(e.target.value))}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-white"
                >
                  <option value={1}>Reserve #1</option>
                  <option value={2}>Reserve #2</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Withdrawing Finalist Seat:</label>
                <select
                  value={withdrawingSeat}
                  onChange={(e) => setWithdrawingSeat(Number(e.target.value))}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-white"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                    <option key={s} value={s}>
                      Seat #{s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Documented Reason:</label>
                <input
                  type="text"
                  value={promoteReason}
                  onChange={(e) => setPromoteReason(e.target.value)}
                  placeholder="Official reason for reserve promotion..."
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowPromoteModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestPromoteReserve}
                disabled={isSubmittingAction || promoteReason.trim().length < 5}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition disabled:opacity-50"
              >
                Request Promotion Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: VOID & REISSUE SESSION ── */}
      {voidSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="max-w-md w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Void and Reissue Examination Session</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Submits a dual-approval request to void session <code className="text-amber-300">{voidSessionId.slice(0, 8)}</code> due to verified technical failure. A maximum of 1 reissue per contestant is permitted by database constraint.
            </p>

            <textarea
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Detailed justification for voiding session (e.g. verified ISP blackout)..."
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setVoidSessionId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestVoidSession}
                disabled={isSubmittingAction || voidReason.trim().length < 5}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition disabled:opacity-50"
              >
                Request Void Approval
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

