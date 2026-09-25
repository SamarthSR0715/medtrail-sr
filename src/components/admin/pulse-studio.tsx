import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  Save,
  Send,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Award,
  Layers,
  Clock,
  RotateCcw,
  BookOpen,
  Calendar,
  Lock,
  Unlock,
  ChevronRight,
  ChevronLeft,
  FileEdit,
  Eye,
  Check,
  Play,
  Pause,
  Square,
  Flame,
  Trophy,
  Users,
  Bell,
  Download,
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  ShieldAlert,
  Radio,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createEmptyPulseQuestions,
  fetchPulseSetForDate,
  savePulseDraft,
  publishTodayPulse,
  DEFAULT_PULSE_SUBJECTS,
  DEFAULT_DIFFICULTIES,
  fetchLiveOpsState,
  updateLiveOpsState,
  fetchLiveDashboardStats,
  declareFinalResults,
  sendPushNotification,
  applyEmergencyAction,
  exportRegistrationsCSV,
  exportScoresCSV,
  exportLeaderboardCSV,
  NOTIFICATION_TEMPLATES,
  type PulseQuestionInput,
  type PulseSubject,
  type PulseDifficulty,
  type PulseCorrectAnswer,
  type PulseSetRecord,
  type LiveOpsState,
  type LiveAnalytics,
} from "@/lib/pulse-admin-service";
import { getISTDateString } from "@/lib/championship-service";

export function PulseStudio() {
  const todayIST = getISTDateString();
  const [pulseDate, setPulseDate] = useState<string>(todayIST);
  const [questions, setQuestions] = useState<PulseQuestionInput[]>(createEmptyPulseQuestions());
  const [activeSlot, setActiveSlot] = useState<number>(1);
  const [status, setStatus] = useState<"draft" | "published" | "empty">("empty");
  const [loading, setLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<boolean>(false);

  // Sub-tabs in Pulse Studio
  const [studioTab, setStudioTab] = useState<"editor" | "live_ops" | "analytics" | "notifications" | "export">("editor");

  // ── LIVE OPS STATE ───────────────────────────────────────────────────────────
  const [liveOps, setLiveOps] = useState<LiveOpsState>({
    id: "singleton",
    registration_open: true,
    live_status: "published",
    target_date: "2026-09-27",
    go_live_time: "19:00",
    end_time: "23:59",
    extended_minutes: 0,
    is_leaderboard_frozen: false,
    results_declared: false,
    results_declared_at: null,
    emergency_action_log: [],
    notifications: [],
    updated_at: new Date().toISOString(),
  });

  // ── LIVE DASHBOARD ANALYTICS ─────────────────────────────────────────────────
  const [analytics, setAnalytics] = useState<LiveAnalytics>({
    registered: 0,
    online: 0,
    attempted: 0,
    completed: 0,
    averageScore: 0,
  });
  const [autoRefreshTimer, setAutoRefreshTimer] = useState<number>(7);
  const [isRefreshingStats, setIsRefreshingStats] = useState<boolean>(false);

  // ── CONFIRMATION MODALS ──────────────────────────────────────────────────────
  const [showGoLiveModal, setShowGoLiveModal] = useState<boolean>(false);
  const [showDeclareModal, setShowDeclareModal] = useState<boolean>(false);
  const [declareConfirmText, setDeclareConfirmText] = useState<string>("");
  const [showEmergencyModal, setShowEmergencyModal] = useState<boolean>(false);
  const [selectedEmergency, setSelectedEmergency] = useState<"extend_10" | "restart" | "cancel">("extend_10");

  // ── NOTIFICATIONS STATE ──────────────────────────────────────────────────────
  const [selectedNotifTemplate, setSelectedNotifTemplate] = useState<string>("reg_open");
  const [notifTitle, setNotifTitle] = useState<string>(NOTIFICATION_TEMPLATES[0]!.title);
  const [notifBody, setNotifBody] = useState<string>(NOTIFICATION_TEMPLATES[0]!.body);
  const [notifScheduleTime, setNotifScheduleTime] = useState<string>("");
  const [isSendingNotif, setIsSendingNotif] = useState<boolean>(false);

  // ── EXPORT STATE ─────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState<string | null>(null);

  // Load existing pulse set for the selected date
  const loadPulseSet = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const record = await fetchPulseSetForDate(date);
      if (record && record.questions && record.questions.length > 0) {
        const filled = createEmptyPulseQuestions().map((emptyQ, idx) => {
          return record.questions[idx] || emptyQ;
        });
        setQuestions(filled);
        setStatus(record.status);
        setPublishedAt(record.published_at);
      } else {
        setQuestions(createEmptyPulseQuestions());
        setStatus("empty");
        setPublishedAt(null);
      }
    } catch (err) {
      console.error("Error loading pulse set:", err);
      toast.error("Failed to load pulse set for date.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load live ops state and analytics
  const refreshLiveOps = useCallback(async () => {
    try {
      const ops = await fetchLiveOpsState();
      setLiveOps(ops);
    } catch (err) {
      console.error("Failed to fetch live ops:", err);
    }
  }, []);

  const refreshAnalytics = useCallback(async () => {
    setIsRefreshingStats(true);
    try {
      const stats = await fetchLiveDashboardStats(liveOps.target_date);
      setAnalytics(stats);
    } catch (err) {
      console.error("Failed to fetch live dashboard stats:", err);
    } finally {
      setIsRefreshingStats(false);
    }
  }, [liveOps.target_date]);

  useEffect(() => {
    loadPulseSet(pulseDate);
  }, [pulseDate, loadPulseSet]);

  useEffect(() => {
    refreshLiveOps();
    refreshAnalytics();
  }, [refreshLiveOps, refreshAnalytics]);

  // 5-10 second auto-refresh cycle for Live Dashboard
  useEffect(() => {
    const timer = setInterval(() => {
      setAutoRefreshTimer((prev) => {
        if (prev <= 1) {
          refreshAnalytics();
          refreshLiveOps();
          return 7;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [refreshAnalytics, refreshLiveOps]);

  const currentQ = questions[activeSlot - 1] || questions[0]!;

  const handleUpdateCurrentQuestion = (fields: Partial<PulseQuestionInput>) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === activeSlot - 1 ? { ...q, ...fields } : q))
    );
  };

  // ── 1. REGISTRATION LOCK CONTROLS ───────────────────────────────────────────
  const handleToggleRegistration = async (open: boolean) => {
    try {
      const res = await updateLiveOpsState({ registration_open: open });
      if (res.success && res.data) {
        setLiveOps(res.data);
        toast.success(open ? "🟢 Registration is now OPEN to students." : "🔒 Registration is now LOCKED. No new sign-ups permitted.");
      } else {
        toast.error("Failed to update registration status.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Registration status update error.");
    }
  };

  // ── 2. GO LIVE CONTROLS ──────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      const res = await savePulseDraft(pulseDate, questions);
      if (res.success) {
        setStatus("draft");
        await updateLiveOpsState({ live_status: "draft" });
        await refreshLiveOps();
        toast.success(`Draft saved for ${pulseDate}!`);
      } else {
        toast.error(res.error || "Failed to save draft.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error saving draft.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const res = await publishTodayPulse(pulseDate, questions);
      if (res.success) {
        setStatus("published");
        setPublishedAt(new Date().toISOString());
        await updateLiveOpsState({ live_status: "published" });
        await refreshLiveOps();
        toast.success(`Published Pulse for ${pulseDate}! It will be live at 7:00 PM IST.`);
      } else {
        toast.error(res.error || "Validation failed: please complete all 5 questions.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to publish pulse.");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleConfirmGoLive = async () => {
    setShowGoLiveModal(false);
    try {
      const res = await updateLiveOpsState({ live_status: "live" });
      if (res.success && res.data) {
        setLiveOps(res.data);
        toast.success("🔥 PULSE IS NOW LIVE FOR ALL PARTICIPANTS!");
        // Send automatic broadcast
        await sendPushNotification({
          templateKey: "pulse_live",
          title: "🔴 CHAMPIONSHIP PULSE IS LIVE!",
          body: "The window is now open! 5 clinical challenge slots are waiting. Rise through every pulse.",
        });
      } else {
        toast.error("Failed to start live pulse.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error going live.");
    }
  };

  const handlePausePulse = async () => {
    try {
      const res = await updateLiveOpsState({ live_status: "paused" });
      if (res.success && res.data) {
        setLiveOps(res.data);
        toast.warning("⏸️ Pulse has been PAUSED. Submissions temporarily suspended.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error pausing pulse.");
    }
  };

  const handleEndPulse = async () => {
    try {
      const res = await updateLiveOpsState({ live_status: "ended" });
      if (res.success && res.data) {
        setLiveOps(res.data);
        toast.info("⏹️ Pulse session officially ended.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error ending pulse.");
    }
  };

  // ── 3. COUNTDOWN CONFIGURATION ───────────────────────────────────────────────
  const handleUpdateCountdown = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await updateLiveOpsState({
        target_date: liveOps.target_date,
        go_live_time: liveOps.go_live_time,
        end_time: liveOps.end_time,
      });
      if (res.success && res.data) {
        setLiveOps(res.data);
        toast.success("⏱️ Countdown time window synchronized for all students!");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update countdown.");
    }
  };

  // ── 5. LEADERBOARD LOCK (DECLARE FINAL RESULTS) ──────────────────────────────
  const handleDeclareResults = async () => {
    if (declareConfirmText.trim().toUpperCase() !== "CONFIRM") {
      toast.error("Please type 'CONFIRM' to verify final results declaration.");
      return;
    }
    setShowDeclareModal(false);
    try {
      const res = await declareFinalResults();
      if (res.success) {
        toast.success(res.message);
        await refreshLiveOps();
        await refreshAnalytics();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || "Error declaring final results.");
    }
  };

  // ── 6. NOTIFICATION TEMPLATE SELECTION ────────────────────────────────────────
  const handleSelectTemplate = (templateKey: string) => {
    setSelectedNotifTemplate(templateKey);
    const tmpl = NOTIFICATION_TEMPLATES.find((t) => t.key === templateKey);
    if (tmpl) {
      setNotifTitle(tmpl.title);
      setNotifBody(tmpl.body);
    }
  };

  const handleSendNotification = async (isScheduled: boolean) => {
    if (!notifTitle.trim() || !notifBody.trim()) {
      toast.error("Please provide both notification title and body.");
      return;
    }
    setIsSendingNotif(true);
    try {
      const res = await sendPushNotification({
        templateKey: selectedNotifTemplate,
        title: notifTitle.trim(),
        body: notifBody.trim(),
        scheduledAt: isScheduled ? notifScheduleTime : undefined,
      });
      if (res.success) {
        toast.success(isScheduled ? "Notification scheduled successfully!" : "Push notification broadcasted to all participants!");
        await refreshLiveOps();
      } else {
        toast.error("Failed to send notification.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Notification transmission error.");
    } finally {
      setIsSendingNotif(false);
    }
  };

  // ── 7. EXPORT HELPERS ────────────────────────────────────────────────────────
  const handleExport = async (type: "registrations" | "scores" | "leaderboard") => {
    setIsExporting(type);
    try {
      if (type === "registrations") {
        const res = await exportRegistrationsCSV();
        toast.success(`Exported ${res.count} registrations to CSV!`);
      } else if (type === "scores") {
        const res = await exportScoresCSV(liveOps.target_date);
        toast.success(`Exported ${res.count} student attempt scores to CSV!`);
      } else {
        const res = await exportLeaderboardCSV();
        toast.success(`Exported ${res.count} leaderboard standings to CSV!`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Export failed.");
    } finally {
      setIsExporting(null);
    }
  };

  // ── 8. EMERGENCY ACTIONS ─────────────────────────────────────────────────────
  const handleApplyEmergency = async () => {
    setShowEmergencyModal(false);
    try {
      const res = await applyEmergencyAction(selectedEmergency);
      if (res.success) {
        toast.success(res.message);
        await refreshLiveOps();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || "Emergency action failed.");
    }
  };

  // Validation helper
  const validationSummary = useMemo(() => {
    const missing: { slot: number; issues: string[] }[] = [];
    questions.forEach((q, idx) => {
      const issues: string[] = [];
      if (!q.question.trim()) issues.push("Missing question text");
      if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim()) {
        issues.push("Missing options");
      }
      if (!q.explanation.trim()) issues.push("Missing explanation");
      if (!q.correct_answer) issues.push("Missing correct answer");
      if (issues.length > 0) {
        missing.push({ slot: idx + 1, issues });
      }
    });
    return missing;
  }, [questions]);

  const isValidForPublish = validationSummary.length === 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* ── TOP LIVE OPERATIONS COMMAND DECK ── */}
      <section className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/90 via-[#0A101D]/90 to-[#070B14]/90 p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
          
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 font-mono text-xs font-bold tracking-wider uppercase">
                <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                MEDTRAIL PULSE STUDIO &bull; LIVE OPS
              </span>

              {/* Event Live Status Badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-black tracking-wide uppercase ${
                  liveOps.live_status === "live"
                    ? "bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse"
                    : liveOps.live_status === "paused"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : liveOps.live_status === "ended"
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    liveOps.live_status === "live"
                      ? "bg-red-500 animate-ping"
                      : liveOps.live_status === "paused"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`}
                />
                STATUS: {liveOps.live_status.toUpperCase()}
              </span>

              {/* Requirement 1: Registration Status Badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
                  liveOps.registration_open
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                }`}
              >
                {liveOps.registration_open ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {liveOps.registration_open ? "REGISTRATION OPEN" : "REGISTRATION LOCKED"}
              </span>

              {/* Registered Count */}
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 font-mono text-xs">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                <strong>{analytics.registered.toLocaleString()}</strong> Enrolled
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
              Championship Operations Console
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Real-time administrative control &bull; Questions, live sync, registrations, notifications, and emergency locks.
            </p>
          </div>

          {/* Requirement 2: Go Live Controls Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {liveOps.live_status !== "live" ? (
              <button
                onClick={() => setShowGoLiveModal(true)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-rose-500 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-red-600/30 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>GO LIVE NOW</span>
              </button>
            ) : (
              <button
                onClick={handlePausePulse}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                <Pause className="w-4 h-4 fill-white" />
                <span>PAUSE PULSE</span>
              </button>
            )}

            <button
              onClick={handleEndPulse}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider border border-slate-700 transition cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>END PULSE</span>
            </button>

            {/* Requirement 1: Registration Lock / Unlock Buttons */}
            {liveOps.registration_open ? (
              <button
                onClick={() => handleToggleRegistration(false)}
                className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-bold text-xs border border-rose-500/40 transition cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Close Registration</span>
              </button>
            ) : (
              <button
                onClick={() => handleToggleRegistration(true)}
                className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 font-bold text-xs border border-emerald-500/40 transition cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Open Registration</span>
              </button>
            )}

            {/* Emergency Menu Trigger */}
            <button
              onClick={() => setShowEmergencyModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 font-bold text-xs border border-rose-500/40 transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Emergency</span>
            </button>
          </div>
        </div>

        {/* ── STUDIO SUB-NAVIGATION TABS ── */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-b border-slate-800 pb-4">
          {[
            { id: "editor", label: "Questions Editor (5 Slots)", icon: FileEdit },
            { id: "live_ops", label: "Go LIVE & Countdown", icon: Clock },
            { id: "analytics", label: "Live Dashboard & Analytics", icon: Flame },
            { id: "notifications", label: "Push Notifications", icon: Bell },
            { id: "export", label: "Export CSV Reports", icon: Download },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = studioTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStudioTab(tab.id as any)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isActive
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                    : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── TAB 1: QUESTIONS EDITOR (5 SLOTS) ── */}
        {studioTab === "editor" && (
          <div className="space-y-6 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold text-slate-400 uppercase">Managing Pulse Date:</span>
                <input
                  type="date"
                  value={pulseDate}
                  onChange={(e) => setPulseDate(e.target.value)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewMode(!previewMode)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    previewMode
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-slate-800 text-slate-300 border-slate-700 hover:text-white"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{previewMode ? "Exit Preview" : "Preview Student View"}</span>
                </button>

                <button
                  disabled={isSaving}
                  onClick={handleSaveDraft}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs border border-slate-700 transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5 text-blue-400" />
                  <span>{isSaving ? "Saving..." : "Save Draft"}</span>
                </button>

                <button
                  disabled={isPublishing || !isValidForPublish}
                  onClick={handlePublish}
                  className="inline-flex items-center gap-1.5 px-5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs tracking-wide shadow-md shadow-blue-600/30 transition cursor-pointer disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isPublishing ? "Publishing..." : "Publish Today's Pulse"}</span>
                </button>
              </div>
            </div>

            {/* Validation Notice if incomplete */}
            {!isValidForPublish && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Publishing Requirement:</strong> Exactly 5 questions must be completely filled. Incomplete slots:{" "}
                    {validationSummary.map((m) => `Slot #${m.slot}`).join(", ")}.
                  </span>
                </div>
                <span className="font-mono text-[11px] text-amber-300 shrink-0">
                  {5 - validationSummary.length} of 5 Complete
                </span>
              </div>
            )}

            {/* 5 Slots Selector */}
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {[1, 2, 3, 4, 5].map((slotNum) => {
                const q = questions[slotNum - 1];
                const isComplete =
                  q?.question.trim() &&
                  q.option_a.trim() &&
                  q.option_b.trim() &&
                  q.option_c.trim() &&
                  q.option_d.trim() &&
                  q.explanation.trim();
                const isActive = activeSlot === slotNum;

                return (
                  <button
                    key={slotNum}
                    onClick={() => setActiveSlot(slotNum)}
                    className={`p-3 sm:p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      isActive
                        ? "bg-blue-600/20 border-blue-500 shadow-md shadow-blue-500/20"
                        : isComplete
                        ? "bg-slate-900/60 border-emerald-500/40 hover:border-emerald-500/60"
                        : "bg-slate-900/40 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className={`font-bold ${isActive ? "text-blue-300" : "text-slate-400"}`}>
                        Slot #{slotNum}
                      </span>
                      {isComplete ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-amber-400/80" />
                      )}
                    </div>
                    <div className="mt-2">
                      <div className="text-[11px] font-bold text-white truncate">
                        {q?.subject || "Subject"}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {q?.question ? q.question.slice(0, 24) + "..." : "Empty prompt"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Editor Workspace */}
            <div className="p-6 sm:p-8 rounded-3xl bg-slate-950/70 border border-slate-800/80 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-xl bg-blue-500/20 text-blue-400 font-mono text-xs font-black flex items-center justify-center border border-blue-500/30">
                    #{activeSlot}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Editing Pulse Question #{activeSlot}</h3>
                    <p className="text-[11px] text-slate-400">All fields are mandatory for clinical compliance.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">Subject</label>
                    <select
                      value={currentQ.subject}
                      onChange={(e) => handleUpdateCurrentQuestion({ subject: e.target.value as PulseSubject })}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-medium focus:outline-none focus:border-blue-500"
                    >
                      {DEFAULT_PULSE_SUBJECTS.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">Difficulty</label>
                    <select
                      value={currentQ.difficulty}
                      onChange={(e) => handleUpdateCurrentQuestion({ difficulty: e.target.value as PulseDifficulty })}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-medium focus:outline-none focus:border-blue-500"
                    >
                      {DEFAULT_DIFFICULTIES.map((diff) => (
                        <option key={diff} value={diff}>
                          {diff}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">XP Value</label>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      step={10}
                      value={currentQ.xp_value}
                      onChange={(e) => handleUpdateCurrentQuestion({ xp_value: Number(e.target.value) || 50 })}
                      className="w-24 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Question Text */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>Question Statement <span className="text-red-400">*</span></span>
                  <span className="text-[10px] font-mono text-slate-500">{currentQ.question.length} chars</span>
                </label>
                <textarea
                  rows={3}
                  value={currentQ.question}
                  onChange={(e) => handleUpdateCurrentQuestion({ question: e.target.value })}
                  placeholder="Enter high-yield clinical case vignette or MCQ prompt..."
                  className="w-full px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-white text-xs sm:text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition leading-relaxed"
                />
              </div>

              {/* 4 Options & Correct Answer Radio */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>Answer Options & Correct Answer Indicator <span className="text-red-400">*</span></span>
                  <span className="text-[11px] text-blue-400 font-mono">Select radio next to correct answer</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { key: "option_a" as const, letter: "A" as const },
                    { key: "option_b" as const, letter: "B" as const },
                    { key: "option_c" as const, letter: "C" as const },
                    { key: "option_d" as const, letter: "D" as const },
                  ].map((opt) => {
                    const isCorrect = currentQ.correct_answer === opt.letter;
                    return (
                      <div
                        key={opt.key}
                        className={`p-3 rounded-2xl border transition-all flex items-center gap-3 ${
                          isCorrect
                            ? "bg-emerald-950/30 border-emerald-500/60 shadow-sm shadow-emerald-500/10"
                            : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleUpdateCurrentQuestion({ correct_answer: opt.letter })}
                          className={`w-8 h-8 rounded-xl font-mono text-xs font-black shrink-0 flex items-center justify-center transition cursor-pointer ${
                            isCorrect
                              ? "bg-emerald-500 text-slate-950 font-bold"
                              : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
                          }`}
                        >
                          {opt.letter}
                        </button>
                        <input
                          type="text"
                          value={currentQ[opt.key]}
                          onChange={(e) => handleUpdateCurrentQuestion({ [opt.key]: e.target.value })}
                          placeholder={`Option ${opt.letter} description...`}
                          className="w-full bg-transparent text-white text-xs sm:text-sm focus:outline-none placeholder:text-slate-600"
                        />
                        {isCorrect && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                            Correct
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Explanation Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>Faculty Clinical Explanation (Shown after student submits) <span className="text-red-400">*</span></span>
                  <span className="text-[10px] font-mono text-slate-500">{currentQ.explanation.length} chars</span>
                </label>
                <textarea
                  rows={3}
                  value={currentQ.explanation}
                  onChange={(e) => handleUpdateCurrentQuestion({ explanation: e.target.value })}
                  placeholder="Provide diagnostic criteria, pathophysiology, and distractor rationale for student review..."
                  className="w-full px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-white text-xs sm:text-sm focus:outline-none focus:border-blue-500 transition leading-relaxed"
                />
              </div>

              {/* Slot Navigation Bar */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  disabled={activeSlot === 1}
                  onClick={() => setActiveSlot((prev) => Math.max(1, prev - 1))}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:text-white border border-slate-800 disabled:opacity-40 transition cursor-pointer text-xs font-bold"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous Slot</span>
                </button>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-400">Slot {activeSlot} of 5</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete and clear question data for Slot #${activeSlot}?`)) {
                        handleUpdateCurrentQuestion({
                          question: "",
                          option_a: "",
                          option_b: "",
                          option_c: "",
                          option_d: "",
                          explanation: "",
                        });
                        toast.info(`Slot #${activeSlot} question cleared`);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-950/80 text-rose-300 border border-rose-500/30 text-xs font-bold transition cursor-pointer"
                    title="Delete / Reset Slot Question"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Delete Question</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={activeSlot === 5}
                  onClick={() => setActiveSlot((prev) => Math.min(5, prev + 1))}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition cursor-pointer text-xs font-bold shadow-md shadow-blue-600/30"
                >
                  <span>Next Slot</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: GO LIVE & COUNTDOWN CONFIGURATION ── */}
        {studioTab === "live_ops" && (
          <div className="space-y-6 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Requirement 3: Countdown Settings */}
              <div className="p-6 rounded-3xl bg-slate-950/70 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <h3 className="text-base font-bold text-white">Event Timing & Countdown Configuration</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Configure the official date and start/end windows. This synchronized countdown displays across all student devices.
                </p>

                <form onSubmit={handleUpdateCountdown} className="space-y-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-300">Competition Date</label>
                    <input
                      type="date"
                      value={liveOps.target_date}
                      onChange={(e) => setLiveOps({ ...liveOps, target_date: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-300">Go Live Time (IST)</label>
                      <input
                        type="time"
                        value={liveOps.go_live_time}
                        onChange={(e) => setLiveOps({ ...liveOps, go_live_time: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-300">End Time (IST)</label>
                      <input
                        type="time"
                        value={liveOps.end_time}
                        onChange={(e) => setLiveOps({ ...liveOps, end_time: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {liveOps.extended_minutes > 0 && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between">
                      <span>Emergency Extension Applied:</span>
                      <strong className="font-mono">+{liveOps.extended_minutes} Minutes</strong>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/30"
                  >
                    Sync Countdown For All Students
                  </button>
                </form>
              </div>

              {/* Requirement 2: Manual Go Live Controls */}
              <div className="p-6 rounded-3xl bg-slate-950/70 border border-slate-800 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-amber-400" />
                    <h3 className="text-base font-bold text-white">Manual Event Lifecycle Controls</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Automatic publishing has been replaced with strict administrator manual control. Change pulse states with immediate student broadcast.
                  </p>

                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Current Status:</span>
                      <span className="font-mono font-bold text-white uppercase">{liveOps.live_status}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Scheduled Date:</span>
                      <span className="font-mono text-slate-300">{liveOps.target_date}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Window:</span>
                      <span className="font-mono text-slate-300">
                        {liveOps.go_live_time} - {liveOps.end_time} IST
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => setShowGoLiveModal(true)}
                    className="py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-red-600/30 flex items-center justify-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Go LIVE</span>
                  </button>

                  <button
                    onClick={handlePausePulse}
                    className="py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Pause className="w-3.5 h-3.5 fill-white" />
                    <span>Pause Pulse</span>
                  </button>

                  <button
                    onClick={handleEndPulse}
                    className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>End Pulse</span>
                  </button>

                  <button
                    onClick={handlePublish}
                    className="py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── TAB 3: LIVE DASHBOARD & ANALYTICS ── */}
        {studioTab === "analytics" && (
          <div className="space-y-6 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">Championship Live Metrics</h3>
                <p className="text-xs text-slate-400">
                  Real-time telemetry updated every 5–10 seconds.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshingStats ? "animate-spin" : ""}`} />
                  Next refresh: {autoRefreshTimer}s
                </span>

                <button
                  onClick={refreshAnalytics}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                >
                  Refresh Now
                </button>
              </div>
            </div>

            {/* Requirement 4: Real-time Analytics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Registered</span>
                <div className="text-2xl sm:text-3xl font-black text-white font-mono mt-2">
                  {analytics.registered.toLocaleString()}
                </div>
                <span className="text-[10px] text-emerald-400 mt-1">Verified Doctors</span>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Online</span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mt-2 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  {analytics.online.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Active Stations</span>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Attempted</span>
                <div className="text-2xl sm:text-3xl font-black text-blue-400 font-mono mt-2">
                  {analytics.attempted.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Started Pulse</span>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Completed</span>
                <div className="text-2xl sm:text-3xl font-black text-purple-400 font-mono mt-2">
                  {analytics.completed.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">All 5 Submitted</span>
              </div>

              <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between col-span-2 sm:col-span-1">
                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Avg Score</span>
                <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono mt-2">
                  {analytics.averageScore}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Points Average</span>
              </div>
            </div>

            {/* Requirement 5: Leaderboard Lock ("Declare Final Results") */}
            <div className="p-6 rounded-3xl bg-gradient-to-r from-amber-950/40 via-slate-950 to-indigo-950/40 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <h4 className="text-base font-bold text-white">Declare Final Results & Freeze Standings</h4>
                </div>
                <p className="text-xs text-slate-400 max-w-xl leading-relaxed">
                  Permanently freezes the leaderboard, locks further attempts, automatically awards digital badges to all qualifiers, and inscripts the Season Champion into the Hall of Fame.
                </p>
              </div>

              {liveOps.results_declared ? (
                <div className="px-5 py-3 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs font-mono uppercase tracking-wider shrink-0 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>Final Results Declared</span>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeclareModal(true)}
                  className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/20 shrink-0"
                >
                  Declare Final Results
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 4: PUSH NOTIFICATIONS STUDIO ── */}
        {studioTab === "notifications" && (
          <div className="space-y-6 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Templates Picker */}
              <div className="md:col-span-5 space-y-3">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                  1-Click Notification Templates
                </label>
                <div className="space-y-2">
                  {NOTIFICATION_TEMPLATES.map((tmpl) => {
                    const isSelected = selectedNotifTemplate === tmpl.key;
                    return (
                      <button
                        key={tmpl.key}
                        onClick={() => handleSelectTemplate(tmpl.key)}
                        className={`w-full p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? "bg-blue-600/20 border-blue-500 text-white"
                            : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">{tmpl.name}</div>
                          <div className="text-[11px] text-slate-400 line-clamp-1">{tmpl.body}</div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compose and Dispatch */}
              <div className="md:col-span-7 p-6 rounded-3xl bg-slate-950/70 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-blue-400" />
                  <h4 className="text-base font-bold text-white">Broadcast Transmission</h4>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Notification Title</label>
                  <input
                    type="text"
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Message Body</label>
                  <textarea
                    rows={3}
                    value={notifBody}
                    onChange={(e) => setNotifBody(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 leading-relaxed"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Schedule Time (Optional for future broadcast)</label>
                  <input
                    type="datetime-local"
                    value={notifScheduleTime}
                    onChange={(e) => setNotifScheduleTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    disabled={isSendingNotif}
                    onClick={() => handleSendNotification(false)}
                    className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Now</span>
                  </button>

                  <button
                    disabled={isSendingNotif || !notifScheduleTime}
                    onClick={() => handleSendNotification(true)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer border border-slate-700 disabled:opacity-40"
                  >
                    Schedule
                  </button>
                </div>

                {/* Sent Notifications History */}
                {liveOps.notifications && liveOps.notifications.length > 0 && (
                  <div className="pt-4 border-t border-slate-800/80 space-y-2">
                    <span className="text-[11px] font-mono text-slate-400 uppercase">Recent Broadcast Logs:</span>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {liveOps.notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/60 text-xs flex items-center justify-between">
                          <div>
                            <div className="font-bold text-white">{n.title}</div>
                            <div className="text-[10px] text-slate-400 line-clamp-1">{n.body}</div>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-400">{n.status.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ── TAB 5: CSV EXPORT REPORTS ── */}
        {studioTab === "export" && (
          <div className="space-y-6 pt-2">
            <div>
              <h3 className="text-lg font-bold text-white">Championship Data Exporter</h3>
              <p className="text-xs text-slate-400">
                Download verified tabular records in CSV format for audits, faculty reviews, and certification issuance.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-6 rounded-3xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <h4 className="text-base font-bold text-white">Season Registrations</h4>
                  <p className="text-xs text-slate-400">
                    All enrolled doctors, colleges, batches, and passport serial IDs.
                  </p>
                </div>

                <button
                  disabled={isExporting !== null}
                  onClick={() => handleExport("registrations")}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-md shadow-blue-600/30 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{isExporting === "registrations" ? "Exporting..." : "Export Registrations (CSV)"}</span>
                </button>
              </div>

              <div className="p-6 rounded-3xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Flame className="w-5 h-5" />
                  </div>
                  <h4 className="text-base font-bold text-white">Pulse Attempt Scores</h4>
                  <p className="text-xs text-slate-400">
                    Individual question accuracy, score breakdowns, time taken, and submitted answers.
                  </p>
                </div>

                <button
                  disabled={isExporting !== null}
                  onClick={() => handleExport("scores")}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{isExporting === "scores" ? "Exporting..." : "Export Scores (CSV)"}</span>
                </button>
              </div>

              <div className="p-6 rounded-3xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <h4 className="text-base font-bold text-white">Standings & Leaderboard</h4>
                  <p className="text-xs text-slate-400">
                    Ranked national standings, aggregate points, accuracy rates, and streak durations.
                  </p>
                </div>

                <button
                  disabled={isExporting !== null}
                  onClick={() => handleExport("leaderboard")}
                  className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-md shadow-amber-600/30 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{isExporting === "leaderboard" ? "Exporting..." : "Export Leaderboard (CSV)"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── MODAL: CONFIRM GO LIVE ── */}
      {showGoLiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-red-500/40 p-6 sm:p-8 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <Play className="w-6 h-6 fill-red-400" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-white">Confirm Go LIVE</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to start the Pulse immediately for all students? This will unlock the 5 questions and allow students to begin submitting attempts right now.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleConfirmGoLive}
                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-red-600/30"
              >
                Yes, Start Pulse Now
              </button>
              <button
                onClick={() => setShowGoLiveModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: DECLARE FINAL RESULTS CONFIRMATION ── */}
      {showDeclareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-amber-500/40 p-6 sm:p-8 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300">
              <Trophy className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-white">Declare Official Final Results</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                This action is irreversible. All further submissions will be locked, leaderboard scores will freeze permanently, and digital accolades will be inscribed into the Hall of Fame.
              </p>
            </div>
            <div className="space-y-1.5 pt-2">
              <label className="text-xs font-bold text-amber-300 font-mono">
                Type "CONFIRM" below to verify:
              </label>
              <input
                type="text"
                value={declareConfirmText}
                onChange={(e) => setDeclareConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm tracking-widest uppercase focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleDeclareResults}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/20"
              >
                Freeze & Declare
              </button>
              <button
                onClick={() => {
                  setShowDeclareModal(false);
                  setDeclareConfirmText("");
                }}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EMERGENCY CONTROLS ── */}
      {showEmergencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-rose-500/40 p-6 sm:p-8 space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-white">Emergency Intervention</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Select an emergency override to protect competition integrity during technical or connectivity anomalies.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              {[
                { id: "extend_10" as const, label: "Extend Pulse (+10 Minutes)", desc: "Increases remaining time for all students by 10 minutes." },
                { id: "restart" as const, label: "Restart Pulse", desc: "Forces live status back to active and resets session timers." },
                { id: "cancel" as const, label: "Cancel Pulse", desc: "Instantly halts pulse submissions and sets status to Paused." },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedEmergency(opt.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                    selectedEmergency === opt.id
                      ? "bg-rose-950/40 border-rose-500 text-white"
                      : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold">{opt.label}</div>
                    <div className="text-[11px] text-slate-400">{opt.desc}</div>
                  </div>
                  {selectedEmergency === opt.id && <Check className="w-4 h-4 text-rose-400 shrink-0" />}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleApplyEmergency}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-rose-600/30"
              >
                Apply Emergency Override
              </button>
              <button
                onClick={() => setShowEmergencyModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
