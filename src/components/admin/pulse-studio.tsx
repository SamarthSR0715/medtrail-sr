import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  normalizeCorrectAnswer,
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
import {
  savePulseSettingsRecord,
  fetchCompetitionSettings,
} from "@/lib/competition-settings-service";
import { fetchRegisteredDeviceStats } from "@/lib/fcm-client";
import { supabase } from "@/integrations/supabase/client";

export function PulseStudio() {
  const todayIST = getISTDateString();
  const [pulseDate, setPulseDate] = useState<string>(todayIST);

  /**
   * Patches the single pulse_settings row (id = 1).
   * Does NOT write 'id' in the update payload.
   * Uses UPDATE without any INSERT/UPSERT to prevent identity column errors.
   */
  const patchPulseSettings = async (fields: Record<string, unknown>): Promise<{ error: any }> => {
    try {
      // Do not write the id field in the update payload
      const { id, ...updateFields } = fields;
      console.log("[patchPulseSettings] updating pulse_settings id=1 with:", updateFields);
      const result = await (supabase as any)
        .from("pulse_settings")
        .update(updateFields)
        .eq("id", 1);
      console.log("[patchPulseSettings] update result:", result);
      return result;
    } catch (err: any) {
      console.error("[patchPulseSettings] exception:", err);
      return { error: err };
    }
  };
  const [questions, setQuestions] = useState<PulseQuestionInput[]>(createEmptyPulseQuestions());
  const [activeSlot, setActiveSlot] = useState<number>(1);
  const [status, setStatus] = useState<"draft" | "published" | "empty">("empty");
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [simulatedOption, setSimulatedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [simulatedSubmitted, setSimulatedSubmitted] = useState<boolean>(false);

  // Sub-tabs in Pulse Studio
  const [studioTab, setStudioTab] = useState<"editor" | "live_ops" | "analytics" | "notifications" | "export">("editor");

  // ── LIVE OPS STATE ───────────────────────────────────────────────────────────
  const [liveOps, setLiveOps] = useState<LiveOpsState>({
    id: "singleton",
    registration_open: true,
    live_status: "published",
    target_date: todayIST,
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
  const [deviceStats, setDeviceStats] = useState<{ total: number; android: number; ios: number; web: number }>({
    total: 0,
    android: 0,
    ios: 0,
    web: 0,
  });

  // ── EXPORT STATE ─────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState<string | null>(null);

  // Load existing pulse set for the selected date and PRELOAD previously selected correct option
  const loadPulseSet = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const record = await fetchPulseSetForDate(date);
      if (record && record.questions && record.questions.length > 0) {
        const filled: PulseQuestionInput[] = [1, 2, 3, 4, 5].map((slotNum, idx) => {
          const existing = record.questions.find((q: any) => q.slot === slotNum) || record.questions[idx];
          if (existing) {
            return {
              slot: slotNum,
              question: existing.question || "",
              option_a: existing.option_a || (existing as any).optionA || "",
              option_b: existing.option_b || (existing as any).optionB || "",
              option_c: existing.option_c || (existing as any).optionC || "",
              option_d: existing.option_d || (existing as any).optionD || "",
              correct_answer: normalizeCorrectAnswer(
                existing.correct_answer ??
                (existing as any).correctAnswer ??
                (existing as any).correct_option ??
                (existing as any).correctIndex
              ) as PulseCorrectAnswer,
              explanation: existing.explanation || "",
              subject: existing.subject || DEFAULT_PULSE_SUBJECTS[idx] || "General",
              difficulty: existing.difficulty || (slotNum === 5 ? "Easy" : "Medium"),
              xp_value: Number(existing.xp_value) || 50,
            };
          }
          return {
            slot: slotNum,
            question: "",
            option_a: "",
            option_b: "",
            option_c: "",
            option_d: "",
            correct_answer: "" as PulseCorrectAnswer,
            explanation: "",
            subject: DEFAULT_PULSE_SUBJECTS[idx] || "General",
            difficulty: slotNum === 5 ? "Easy" : "Medium",
            xp_value: 50,
          };
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
      const [ops, compSettings, devStats] = await Promise.all([
        fetchLiveOpsState(),
        fetchCompetitionSettings(),
        fetchRegisteredDeviceStats(),
      ]);

      const effectiveTargetDate = compSettings.competition_date || ops.target_date || todayIST;
      const effectiveStartTime = compSettings.start_time || ops.go_live_time || "19:00";
      const effectiveEndTime = compSettings.end_time || ops.end_time || "23:59";
      const effectiveStatus = (compSettings.pulse_status as any) || ops.live_status || "published";

      setDeviceStats(devStats);

      setLiveOps({
        ...ops,
        target_date: effectiveTargetDate,
        go_live_time: effectiveStartTime,
        end_time: effectiveEndTime,
        live_status: effectiveStatus,
        results_declared: compSettings.results_published || ops.results_declared,
      });
    } catch (err) {
      console.error("Failed to fetch live ops:", err);
    }
  }, [todayIST]);

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

    // Supabase Realtime subscription for pulse_settings and attempt analytics
    const channel = supabase
      .channel("pulse_studio_realtime_v3")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pulse_settings" },
        (payload: any) => {
          if (payload?.new) {
            const row = payload.new;
            setLiveOps((prev) => ({
              ...prev,
              target_date: row.competition_date || prev.target_date,
              go_live_time: row.start_time || prev.go_live_time,
              end_time: row.end_time || prev.end_time,
              live_status: row.pulse_status || prev.live_status,
              results_declared: row.results_published !== undefined ? row.results_published : prev.results_declared,
            }));
          }
          refreshLiveOps();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_pulse_attempts" },
        () => {
          refreshAnalytics();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshLiveOps, refreshAnalytics]);

  // Periodic heartbeat timer for live dashboard
  useEffect(() => {
    const timer = setInterval(() => {
      setAutoRefreshTimer((prev) => {
        if (prev <= 1) {
          refreshAnalytics();
          refreshLiveOps();
          return 10;
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
      // 1. Publish the question set to Supabase (championship_pulse_sets)
      const pubRes = await publishTodayPulse(pulseDate, questions);
      if (!pubRes.success) {
        toast.error(pubRes.error || "Failed to publish pulse questions.");
        return;
      }

      // 2. Direct Supabase PATCH: mark results_published = true on pulse_settings (DO NOT reset pulse_status)
      const { error } = await patchPulseSettings({ results_published: true });

      if (error) {
        toast.error(`Publish failed: ${error.message}`);
        return;
      }

      // 3. Background: sync results_published only, preserving pulse_status
      savePulseSettingsRecord({ results_published: true }).catch(() => { });
      updateLiveOpsState({ results_declared: true }).catch(() => { });

      // 4. Update React state - preserve current live_status
      setStatus("published");
      setPublishedAt(new Date().toISOString());
      setLiveOps((prev) => ({ ...prev, results_declared: true }));

      toast.success(`Published Pulse for ${pulseDate}! Results visible to students.`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to publish pulse.");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleConfirmGoLive = async () => {
    setShowGoLiveModal(false);
    try {
      // 1. Direct Supabase PATCH: pulse_settings row 1 -> pulse_status = 'live'
      const { error } = await patchPulseSettings({ pulse_status: "live" });

      if (error) {
        toast.error(`Go Live failed: ${error.message}`);
        return;
      }

      // 2. Sync local cache and liveOps state
      setCachedSetting("pulse_status", "live");
      updateLiveOpsState({ live_status: "live" }).catch(() => { });

      // 3. Update React state
      setLiveOps((prev) => ({ ...prev, live_status: "live" }));
      toast.success("🔥 PULSE IS NOW LIVE FOR ALL PARTICIPANTS!");

      sendPushNotification({
        templateKey: "pulse_live",
        title: "🔴 CHAMPIONSHIP PULSE IS LIVE!",
        body: "The window is now open! 5 clinical challenge slots are waiting. Rise through every pulse.",
      }).catch(() => { });
    } catch (err: any) {
      toast.error(err?.message || "Error going live.");
    }
  };

const handlePausePulse = async () => {
  try {
    // Direct Supabase PATCH: pulse_settings -> pulse_status = 'paused'
    const { error } = await patchPulseSettings({ pulse_status: "paused" });

    if (error) {
      toast.error(`Pause failed: ${error.message}`);
      return;
    }

    setCachedSetting("pulse_status", "paused");
    setLiveOps((prev) => ({ ...prev, live_status: "paused" }));
    toast.warning("⏸️ Pulse has been PAUSED. Submissions temporarily suspended.");

    updateLiveOpsState({ live_status: "paused" }).catch(() => { });
  } catch (err: any) {
    toast.error(err?.message || "Error pausing pulse.");
  }
};

const handleEndPulse = async () => {
  try {
    // Direct Supabase PATCH: pulse_settings -> pulse_status = 'ended'
    const { error } = await patchPulseSettings({ pulse_status: "ended" });

    if (error) {
      toast.error(`End Pulse failed: ${error.message}`);
      return;
    }

    setCachedSetting("pulse_status", "ended");
    setLiveOps((prev) => ({ ...prev, live_status: "ended" }));
    toast.info("⏹️ Pulse session officially ended.");

    updateLiveOpsState({ live_status: "ended" }).catch(() => { });
  } catch (err: any) {
    toast.error(err?.message || "Error ending pulse.");
  }
};

// ── 3. COUNTDOWN CONFIGURATION ───────────────────────────────────────────────
const handleUpdateCountdown = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    // 1. Immediately persist to Supabase pulse_settings (date and time ONLY, never overwrite pulse_status)
    await savePulseSettingsRecord({
      competition_date: liveOps.target_date,
      start_time: liveOps.go_live_time,
      end_time: liveOps.end_time,
    });

    // 2. Persist to championship_live_ops (date and time ONLY)
    const res = await updateLiveOpsState({
      target_date: liveOps.target_date,
      go_live_time: liveOps.go_live_time,
      end_time: liveOps.end_time,
    });

    if (res.success && res.data) {
      setLiveOps((prev) => ({
        ...prev,
        target_date: liveOps.target_date,
        go_live_time: liveOps.go_live_time,
        end_time: liveOps.end_time,
      }));
    }

    toast.success("⏱️ Countdown time window synchronized for all students!");
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
    // 1. Await Supabase update using shared persistence function
    await savePulseSettingsRecord({ results_published: true, pulse_status: "ended" });

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
    const norm = normalizeCorrectAnswer(q.correct_answer);
    if (!norm || !["A", "B", "C", "D"].includes(norm)) {
      issues.push("Missing correct answer (select radio A, B, C, or D)");
    }
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
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-black tracking-wide uppercase ${liveOps.live_status === "live"
                ? "bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse"
                : liveOps.live_status === "paused"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : liveOps.live_status === "ended"
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${liveOps.live_status === "live"
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
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${liveOps.registration_open
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
              onClick={handleConfirmGoLive}
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
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${isActive
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
                onClick={() => {
                  setPreviewMode(!previewMode);
                  setSimulatedOption(null);
                  setSimulatedSubmitted(false);
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${previewMode
                  ? "bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20"
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
                  onClick={() => {
                    setActiveSlot(slotNum);
                    setSimulatedOption(null);
                    setSimulatedSubmitted(false);
                  }}
                  className={`p-3 sm:p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${isActive
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

          {/* ── STUDENT VIEW LIVE SIMULATION PREVIEW (Active when previewMode is true) ── */}
          {previewMode && (
            <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-indigo-950/40 via-slate-900/80 to-slate-950/90 border-2 border-indigo-500/50 space-y-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-500/30 pb-4">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    STUDENT VIEW SIMULATION &bull; SLOT #{activeSlot}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Verified Key: {currentQ.correct_answer ? `Option ${currentQ.correct_answer}` : "None Selected"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-400">{currentQ.subject} &bull; {currentQ.difficulty}</span>
                  <span className="px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">
                    +{currentQ.xp_value} XP
                  </span>
                </div>
              </div>

              {/* Simulated Question Prompt */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">Clinical Vignette / Question Prompt:</h4>
                <p className="text-base sm:text-lg font-medium text-white leading-relaxed bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
                  {currentQ.question.trim() || <span className="text-slate-500 italic">No question statement entered yet.</span>}
                </p>
              </div>

              {/* Simulated Options */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Test student option selection & verify answer key evaluation:</span>
                  <span className="font-mono text-[11px] text-indigo-300">Click any option to test answer comparison</span>
                </div>

                {[
                  { key: "option_a" as const, letter: "A" as const, text: currentQ.option_a },
                  { key: "option_b" as const, letter: "B" as const, text: currentQ.option_b },
                  { key: "option_c" as const, letter: "C" as const, text: currentQ.option_c },
                  { key: "option_d" as const, letter: "D" as const, text: currentQ.option_d },
                ].map((opt) => {
                  const isSelected = simulatedOption === opt.letter;
                  const isTheCorrectKey = currentQ.correct_answer === opt.letter;

                  let cardStyle = "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700";
                  if (simulatedSubmitted) {
                    if (isTheCorrectKey) {
                      cardStyle = "bg-emerald-950/40 border-emerald-500/80 text-emerald-200 ring-1 ring-emerald-500/50 shadow-md shadow-emerald-500/20";
                    } else if (isSelected && !isTheCorrectKey) {
                      cardStyle = "bg-rose-950/40 border-rose-500/80 text-rose-300 line-through ring-1 ring-rose-500/40";
                    }
                  } else if (isSelected) {
                    cardStyle = "bg-blue-950/40 border-blue-500 text-blue-200 ring-1 ring-blue-500/50";
                  }

                  return (
                    <div
                      key={opt.letter}
                      onClick={() => {
                        if (!simulatedSubmitted) setSimulatedOption(opt.letter);
                      }}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${cardStyle}`}
                    >
                      <div className="flex items-center gap-3.5">
                        {/* Radio visual indicator */}
                        <span className={`font-mono text-sm font-bold ${simulatedSubmitted && isTheCorrectKey
                          ? "text-emerald-400"
                          : isSelected
                            ? "text-blue-400"
                            : "text-slate-400"
                          }`}>
                          {isSelected || (simulatedSubmitted && isTheCorrectKey) ? "(●)" : "( )"}
                        </span>

                        <span className={`px-2.5 py-1 rounded-xl font-mono text-xs font-bold ${simulatedSubmitted && isTheCorrectKey
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : isSelected
                            ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                            : "bg-slate-800 text-slate-400"
                          }`}>
                          Option {opt.letter}
                        </span>

                        <span className="text-sm">
                          {opt.text.trim() || <span className="text-slate-600 italic">Empty choice</span>}
                        </span>
                      </div>

                      <div className="shrink-0 font-mono text-xs">
                        {simulatedSubmitted && isTheCorrectKey && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            Correct Answer
                          </span>
                        )}
                        {simulatedSubmitted && isSelected && !isTheCorrectKey && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            Student's Wrong Choice
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Simulation Action Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-indigo-500/20">
                <div className="flex items-center gap-2">
                  {!simulatedSubmitted ? (
                    <button
                      type="button"
                      disabled={!simulatedOption}
                      onClick={() => setSimulatedSubmitted(true)}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/30 disabled:opacity-40"
                    >
                      Submit Student Answer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSimulatedSubmitted(false);
                        setSimulatedOption(null);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Student Simulation</span>
                    </button>
                  )}
                </div>

                {simulatedSubmitted && (
                  <div className="flex items-center gap-2">
                    {simulatedOption === currentQ.correct_answer ? (
                      <div className="p-2.5 px-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Simulation: CORRECT! Awarded +{currentQ.xp_value} XP & Points</span>
                      </div>
                    ) : (
                      <div className="p-2.5 px-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400" />
                        <span>Simulation: INCORRECT (0 XP). Verified Correct Answer: Option {currentQ.correct_answer || "Unselected"}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Simulated Explanation Card */}
              {simulatedSubmitted && currentQ.explanation && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-blue-500/30 space-y-2 animate-in fade-in">
                  <div className="flex items-center gap-1.5 text-blue-300 font-bold text-xs uppercase tracking-wider">
                    <BookOpen className="w-4 h-4 text-amber-400" />
                    <span>Faculty Clinical Explanation (Shown to Students)</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
                    {currentQ.explanation}
                  </p>
                </div>
              )}
            </div>
          )}

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

            {/* 4 Options & Dynamic Correct Answer Radio Selector */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div>
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>Answer Choices & Correct Option Radio</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Select the radio button beside A, B, C, or D. The selected radio is saved as the verified correct answer in Supabase.
                  </p>
                </div>

                {/* Active Correct Answer Pill */}
                <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 px-3.5 py-1.5 rounded-xl shrink-0">
                  <span className="text-[11px] font-mono text-slate-400">Current Key:</span>
                  {currentQ.correct_answer ? (
                    <span className="px-3 py-1 rounded-full font-mono text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center gap-1.5 shadow-sm">
                      <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                      (●) Option {currentQ.correct_answer}
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full font-mono text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5">
                      <AlertCircle className="size-3 text-amber-400" />
                      ( ) Select Correct Radio
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { key: "option_a" as const, letter: "A" as const },
                  { key: "option_b" as const, letter: "B" as const },
                  { key: "option_c" as const, letter: "C" as const },
                  { key: "option_d" as const, letter: "D" as const },
                ].map((opt) => {
                  const isCorrect = currentQ.correct_answer === opt.letter;
                  const radioId = `correct_choice_radio_slot_${activeSlot}_${opt.letter}`;

                  return (
                    <div
                      key={opt.key}
                      className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 ${isCorrect
                        ? "bg-emerald-950/35 border-emerald-500/90 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40"
                        : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                        }`}
                    >
                      {/* Radio selection area: ( ) Option A vs (●) Option B */}
                      <div className="flex items-center gap-3 shrink-0">
                        <label
                          htmlFor={radioId}
                          className="flex items-center gap-3 cursor-pointer select-none group"
                        >
                          <input
                            type="radio"
                            id={radioId}
                            name={`pulse_slot_${activeSlot}_correct_answer`}
                            value={opt.letter}
                            checked={isCorrect}
                            onChange={() => handleUpdateCurrentQuestion({ correct_answer: opt.letter })}
                            className="w-4 h-4 text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-950 cursor-pointer accent-emerald-500"
                          />

                          {/* Literal ( ) or (●) indicator */}
                          <span
                            className={`font-mono text-sm font-black transition-colors ${isCorrect ? "text-emerald-400 font-bold" : "text-slate-500 group-hover:text-slate-400"
                              }`}
                          >
                            {isCorrect ? "(●)" : "( )"}
                          </span>

                          {/* Option Letter Badge */}
                          <span
                            className={`px-3 py-1 rounded-xl font-mono text-xs font-black tracking-wider transition ${isCorrect
                              ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20"
                              : "bg-slate-800 text-slate-300 group-hover:text-white"
                              }`}
                          >
                            Option {opt.letter}
                          </span>
                        </label>
                      </div>

                      {/* Option Text Input */}
                      <div className="flex-1 w-full">
                        <input
                          type="text"
                          value={currentQ[opt.key]}
                          onChange={(e) => handleUpdateCurrentQuestion({ [opt.key]: e.target.value })}
                          placeholder={`Enter text description for Option ${opt.letter}...`}
                          className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl px-3.5 py-2.5 text-white text-xs sm:text-sm focus:outline-none placeholder:text-slate-600 transition"
                        />
                      </div>

                      {/* Status Label or Click to Set */}
                      <div className="shrink-0 flex items-center justify-end">
                        {isCorrect ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm">
                            <CheckCircle2 className="size-3.5 text-emerald-400" />
                            <span>(●) Correct Answer</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUpdateCurrentQuestion({ correct_answer: opt.letter })}
                            className="px-3.5 py-1.5 rounded-full text-[11px] font-mono text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 bg-slate-950/60 transition cursor-pointer hover:bg-slate-900"
                          >
                            ( ) Set as (●) Correct
                          </button>
                        )}
                      </div>
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
                  onClick={handleConfirmGoLive}
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
                      className={`w-full p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${isSelected
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-blue-400" />
                  <h4 className="text-base font-bold text-white">Broadcast Transmission</h4>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs font-mono font-bold text-blue-300">
                  <Radio className="w-3 h-3 text-blue-400 animate-pulse" />
                  <span>{deviceStats.total} Registered Devices</span>
                </div>
              </div>

              {/* Device Breakdown Pill */}
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Audience Device Reach:</span>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400">Android: <strong>{deviceStats.android}</strong></span>
                  <span className="text-indigo-400">iOS: <strong>{deviceStats.ios}</strong></span>
                  <span className="text-blue-400">Web PWA: <strong>{deviceStats.web}</strong></span>
                </div>
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
                className={`w-full p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${selectedEmergency === opt.id
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
