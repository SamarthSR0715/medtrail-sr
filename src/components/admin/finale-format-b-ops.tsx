import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  Clock,
  FileEdit,
  FlaskConical,
  Laptop,
  Loader2,
  Lock,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  ShieldOff,
  Square,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  createEmptyFinaleQuestions,
  DEFAULT_FINALE_CODE,
  endFinale,
  fetchFinaleAdminOverview,
  FINALE_DIFFICULTIES,
  FINALE_QUESTION_COUNT,
  goLiveFinale,
  manageFinaleTestDevice,
  publishFinaleSet,
  resetFinaleTestSessions,
  subscribeToFinalePublicState,
  validateFinaleQuestionsForPublish,
  type FinaleAdminOverview,
  type FinaleDifficulty,
  type FinaleLifecycleStatus,
  type FinaleQuestionAdminInput,
} from "@/lib/finale-service";

const FINALE_SUBJECT_SUGGESTIONS = [
  "Clinical Medicine",
  "General Surgery",
  "Pathology",
  "Pharmacology",
  "Anatomy",
  "Physiology",
  "Microbiology",
  "Biochemistry",
  "Obstetrics & Gynecology",
  "Pediatrics",
];

function isSlotComplete(q: FinaleQuestionAdminInput): boolean {
  return (
    q.question.trim().length > 0 &&
    q.option_a.trim().length > 0 &&
    q.option_b.trim().length > 0 &&
    q.option_c.trim().length > 0 &&
    q.option_d.trim().length > 0 &&
    ["A", "B", "C", "D"].includes(q.correct_answer) &&
    q.explanation.trim().length > 0 &&
    q.subject.trim().length > 0 &&
    FINALE_DIFFICULTIES.includes(q.difficulty)
  );
}

function isSlotPartial(q: FinaleQuestionAdminInput): boolean {
  return (
    q.question.trim().length > 0 ||
    q.option_a.trim().length > 0 ||
    q.option_b.trim().length > 0 ||
    q.option_c.trim().length > 0 ||
    q.option_d.trim().length > 0 ||
    q.explanation.trim().length > 0
  );
}

function formatShortIST(iso: string | null): string {
  if (!iso) return "—";
  try {
    return (
      new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }) + " IST"
    );
  } catch {
    return iso;
  }
}

export function FinaleFormatBOps() {
  const [subTab, setSubTab] = useState<"questions" | "roster" | "tester" | "leaderboard">("questions");
  const [overview, setOverview] = useState<FinaleAdminOverview | null>(null);
  const [questions, setQuestions] = useState<FinaleQuestionAdminInput[]>(createEmptyFinaleQuestions());
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<"draft" | "publish" | "go_live" | "end" | "reset_test" | null>(null);
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"go_live" | "end" | null>(null);
  const [manualDeviceId, setManualDeviceId] = useState("");
  const [manualDeviceLabel, setManualDeviceLabel] = useState("");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const loadOverview = useCallback(async (preserveEdits: boolean = false) => {
    setLoading(true);
    try {
      const res = await fetchFinaleAdminOverview(DEFAULT_FINALE_CODE);
      if (!res.success) {
        setBannerError(res.error || "Could not load Grand Finale Ops state from Supabase.");
      } else {
        setBannerError(null);
        setOverview(res);
        if (!preserveEdits && res.set && res.set.questions.length > 0) {
          setQuestions(res.set.questions);
        }
      }
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : "Failed to load Finale Ops.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(false);
    const unsub = subscribeToFinalePublicState(DEFAULT_FINALE_CODE, () => {
      loadOverview(true);
    });
    return () => {
      unsub();
    };
  }, [loadOverview]);

  const serverStatus: FinaleLifecycleStatus | "not_created" = overview?.set?.status || "not_created";
  const isFrozen = Boolean(overview?.set?.questionsFrozen) || serverStatus === "live" || serverStatus === "ended" || serverStatus === "closed";
  const completedCount = questions.filter(isSlotComplete).length;

  const updateQuestionSlot = (slotIdx: number, patch: Partial<FinaleQuestionAdminInput>) => {
    if (isFrozen) {
      toast.error("Questions are permanently frozen because the Grand Finale has started.");
      return;
    }
    setHasUnsavedEdits(true);
    setBannerSuccess(null);
    setQuestions((prev) => {
      const next = [...prev];
      const fallback: FinaleQuestionAdminInput = {
        slot: slotIdx + 1,
        question: "",
        option_a: "",
        option_b: "",
        option_c: "",
        option_d: "",
        correct_answer: "A",
        explanation: "",
        subject: "Clinical Medicine",
        difficulty: "Medium",
      };
      const base: FinaleQuestionAdminInput = next[slotIdx] ?? fallback;
      next[slotIdx] = { ...base, ...patch, slot: slotIdx + 1 };
      return next;
    });
  };

  const handleSaveDraft = async () => {
    if (isFrozen) {
      toast.error("Cannot save draft: question set is frozen.");
      return;
    }
    setActionBusy("draft");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await publishFinaleSet({
        finaleCode: DEFAULT_FINALE_CODE,
        questions,
        status: "draft",
      });
      if (!res.success) {
        setBannerError(res.error || "Failed to save Grand Finale draft.");
        toast.error(res.error || "Failed to save Grand Finale draft.");
        return;
      }
      setHasUnsavedEdits(false);
      setBannerSuccess("Draft saved in Supabase (`draft`). Students cannot see questions yet.");
      toast.success("Grand Finale draft saved.");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handlePublish = async () => {
    if (isFrozen) {
      toast.error("Cannot re-publish: question set is frozen.");
      return;
    }
    const check = validateFinaleQuestionsForPublish(questions);
    if (!check.valid) {
      if (check.firstInvalidSlot) setActiveSlot(check.firstInvalidSlot);
      setBannerError(check.error || "Complete all 10 questions before publishing.");
      toast.error(check.error || "Complete all 10 questions before publishing.");
      return;
    }

    setActionBusy("publish");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await publishFinaleSet({
        finaleCode: DEFAULT_FINALE_CODE,
        questions,
        status: "published",
      });
      if (!res.success) {
        setBannerError(res.error || "Publish failed.");
        toast.error(res.error || "Publish failed.");
        return;
      }
      setHasUnsavedEdits(false);
      setBannerSuccess(
        "10 Finale questions published (`published`). Finalists see the Waiting Screen until you click Go Live Finale."
      );
      toast.success("10 questions published! Click Go Live Finale when ready to start.");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handleGoLiveConfirmed = async () => {
    setConfirmAction(null);
    if (hasUnsavedEdits) {
      const msg = "You have unsaved editor changes. Publish the 10 questions before going live.";
      setBannerError(msg);
      toast.error(msg);
      return;
    }
    setActionBusy("go_live");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await goLiveFinale(DEFAULT_FINALE_CODE);
      if (!res.success) {
        setBannerError(res.error || "Failed to Go Live.");
        toast.error(res.error || "Failed to Go Live.");
        return;
      }
      setBannerSuccess("GRAND FINALE IS LIVE! Questions are permanently frozen and the 90-second arena is open to the 10 approved finalists.");
      toast.success("Grand Finale is now LIVE!");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handleEndFinaleConfirmed = async () => {
    setConfirmAction(null);
    setActionBusy("end");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await endFinale(DEFAULT_FINALE_CODE);
      if (!res.success) {
        setBannerError(res.error || "Failed to End Finale.");
        toast.error(res.error || "Failed to End Finale.");
        return;
      }
      const expNote =
        typeof res.expiredSessions === "number" && res.expiredSessions > 0
          ? ` (${res.expiredSessions} unsubmitted active session(s) closed)`
          : "";
      setBannerSuccess(`Grand Finale ENDED cleanly${expNote}. Late submissions are rejected.`);
      toast.success("Grand Finale ended successfully.");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDeviceAction = async (deviceId: string, action: "approve" | "revoke", label?: string) => {
    const cleanId = deviceId.trim();
    if (cleanId.length < 8) {
      toast.error("Device ID must be at least 8 characters.");
      return;
    }
    setDeviceBusyId(cleanId);
    try {
      const res = await manageFinaleTestDevice({
        deviceId: cleanId,
        action,
        ...(label?.trim() ? { deviceLabel: label.trim() } : {}),
      });
      if (!res.success) {
        toast.error(res.error || "Device update failed.");
        return;
      }
      toast.success(action === "approve" ? "Test device authorized for Classic crew." : "Test device revoked.");
      setManualDeviceId("");
      setManualDeviceLabel("");
      await loadOverview(true);
    } finally {
      setDeviceBusyId(null);
    }
  };

  const handleResetTestSessions = async () => {
    setActionBusy("reset_test");
    try {
      const res = await resetFinaleTestSessions(DEFAULT_FINALE_CODE);
      if (!res.success) {
        toast.error(res.error || "Could not reset active test sessions.");
        return;
      }
      toast.success("Active Classic crew test session(s) cleared. Next test launch opens a fresh 90s run.");
      await loadOverview(true);
    } finally {
      setActionBusy(null);
    }
  };

  const defaultStatusBadge = { label: "DRAFT", cls: "bg-slate-800 text-amber-300 border-amber-500/30" };
  const statusMeta: Record<string, { label: string; cls: string }> = {
    not_created: { label: "DRAFT (NOT SAVED)", cls: "bg-slate-800 text-slate-300 border-slate-700" },
    draft: defaultStatusBadge,
    published: { label: "PUBLISHED • WAITING ROOM", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
    live: { label: "LIVE • ARENA OPEN", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 animate-pulse" },
    ended: { label: "ENDED • SUBMISSIONS CLOSED", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
    closed: { label: "ENDED • SUBMISSIONS CLOSED", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  };
  const activeStatusBadge = statusMeta[serverStatus] ?? defaultStatusBadge;

  const rosterList = overview?.roster || [];
  const leaderboardList = overview?.leaderboard || [];
  const testerInfo = overview?.tester || null;

  const curIdx = activeSlot - 1;
  const fallbackQ: FinaleQuestionAdminInput = {
    slot: activeSlot,
    question: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_answer: "A",
    explanation: "",
    subject: "Clinical Medicine",
    difficulty: "Medium",
  };
  const curQ: FinaleQuestionAdminInput = questions[curIdx] ?? fallbackQ;

  return (
    <div className="space-y-6 pt-2">
      {/* ── LIFECYCLE CONTROL DECK ───────────────────────────────────────────── */}
      <div className="p-6 rounded-3xl bg-slate-900/85 border border-amber-500/30 shadow-xl space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-wider">
                <Trophy className="w-3.5 h-3.5" />
                Grand Finale Ops (Format B)
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-black uppercase tracking-wider ${activeStatusBadge.cls}`}>
                <Radio className="w-3.5 h-3.5" />
                {activeStatusBadge.label}
              </span>
              {isFrozen && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold">
                  <Lock className="w-3 h-3" />
                  Questions Frozen
                </span>
              )}
            </div>
            <h3 className="text-xl font-black text-white">Authoritative 10-Question Finale Control</h3>
            <p className="text-xs text-slate-400">
              Independent of Daily Pulse controls &bull; Lifecycle:{" "}
              <span className="text-slate-200 font-semibold">DRAFT → PUBLISHED (Waiting Room) → LIVE (90s Exam) → ENDED</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadOverview(hasUnsavedEdits)}
              disabled={loading || actionBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Sync Server</span>
            </button>

            <button
              type="button"
              disabled={isFrozen || actionBusy !== null}
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "draft" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-slate-400" />}
              <span>{actionBusy === "draft" ? "Saving..." : "Save Draft"}</span>
            </button>

            <button
              type="button"
              disabled={isFrozen || actionBusy !== null}
              onClick={handlePublish}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "publish" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{actionBusy === "publish" ? "Publishing..." : `Publish 10 Questions (${completedCount}/10)`}</span>
            </button>

            <button
              type="button"
              disabled={serverStatus !== "published" || hasUnsavedEdits || actionBusy !== null}
              onClick={() => setConfirmAction("go_live")}
              title={
                hasUnsavedEdits
                  ? "Publish your latest edits before going live"
                  : serverStatus !== "published"
                  ? "Requires status = PUBLISHED"
                  : "Start the LIVE Finale for approved finalists"
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "go_live" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
              <span>{actionBusy === "go_live" ? "Starting..." : "Go Live Finale"}</span>
            </button>

            <button
              type="button"
              disabled={serverStatus !== "live" || actionBusy !== null}
              onClick={() => setConfirmAction("end")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "end" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-white" />}
              <span>{actionBusy === "end" ? "Ending..." : "End Finale"}</span>
            </button>
          </div>
        </div>

        {/* Lifecycle Stepper & Timestamps */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {[
            {
              step: "1. Draft",
              active: serverStatus === "draft" || serverStatus === "not_created",
              done: ["published", "live", "ended", "closed"].includes(serverStatus),
              detail: `${completedCount}/10 validated locally`,
            },
            {
              step: "2. Published (Waiting)",
              active: serverStatus === "published",
              done: ["live", "ended", "closed"].includes(serverStatus),
              detail: overview?.set?.publishedAt ? formatShortIST(overview.set.publishedAt) : "Not published yet",
            },
            {
              step: "3. Live Arena (90s)",
              active: serverStatus === "live",
              done: ["ended", "closed"].includes(serverStatus),
              detail: overview?.set?.liveStartedAt ? formatShortIST(overview.set.liveStartedAt) : "Locked until Go Live",
            },
            {
              step: "4. Ended (Closed)",
              active: serverStatus === "ended" || serverStatus === "closed",
              done: serverStatus === "ended" || serverStatus === "closed",
              detail: overview?.set?.endedAt ? formatShortIST(overview.set.endedAt) : "Pending closure",
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`p-3 rounded-2xl border text-xs ${
                item.active
                  ? "bg-amber-500/15 border-amber-500/50 text-white"
                  : item.done
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-slate-950/70 border-slate-800 text-slate-400"
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>{item.step}</span>
                {item.done && !item.active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <div className="text-[11px] opacity-80 font-mono mt-1 truncate">{item.detail}</div>
            </div>
          ))}
        </div>

        {/* Unsaved edits warning & feedback banners */}
        {hasUnsavedEdits && !isFrozen && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              You have unpublished local changes. Click <strong>Save Draft</strong> or <strong>Publish 10 Questions</strong> to persist them to Supabase.
            </span>
          </div>
        )}

        {bannerError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{bannerError}</span>
          </div>
        )}

        {bannerSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{bannerSuccess}</span>
          </div>
        )}

        {/* Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-slate-950 border border-slate-800 w-fit">
          {[
            { id: "questions", label: `10-Slot Bank (${completedCount}/10)`, icon: FileEdit },
            { id: "roster", label: `Finalist Roster (${rosterList.length}/10)`, icon: Users },
            { id: "tester", label: "Classic Crew Test Access", icon: FlaskConical },
            { id: "leaderboard", label: `Official Standings (${leaderboardList.length})`, icon: Award },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id as typeof subTab)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  active ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20" : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SUB-TAB 1: 10-SLOT QUESTION EDITOR ─────────────────────────────────── */}
      {subTab === "questions" && (
        <div className="space-y-6">
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
            {questions.map((q, idx) => {
              const slotNum = idx + 1;
              const isActive = activeSlot === slotNum;
              const complete = isSlotComplete(q);
              const partial = !complete && isSlotPartial(q);
              return (
                <button
                  key={slotNum}
                  type="button"
                  onClick={() => setActiveSlot(slotNum)}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1 text-center transition cursor-pointer ${
                    isActive
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 ring-2 ring-amber-500/40"
                      : complete
                      ? "bg-slate-900 border-emerald-500/40 text-emerald-300 hover:border-emerald-400"
                      : partial
                      ? "bg-slate-900 border-amber-500/30 text-amber-300"
                      : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <span className="text-[10px] font-mono uppercase text-slate-400">Slot</span>
                  <span className="text-base font-black">{slotNum}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      complete ? "bg-emerald-400" : partial ? "bg-amber-400" : "bg-slate-700"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-black text-sm">
                  {activeSlot}
                </span>
                <div>
                  <h4 className="text-base font-bold text-white flex items-center gap-2">
                    Grand Finale Slot #{activeSlot}
                    {isFrozen && <Lock className="w-3.5 h-3.5 text-indigo-400" />}
                  </h4>
                  <span className="text-xs text-slate-400">100 pts per correct &bull; Shared 90-second timer</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-400">Subject:</label>
                  <input
                    type="text"
                    list="finale-subject-options"
                    disabled={isFrozen}
                    value={curQ.subject}
                    onChange={(e) => updateQuestionSlot(curIdx, { subject: e.target.value })}
                    placeholder="e.g. Clinical Medicine"
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 outline-none w-44 disabled:opacity-60"
                  />
                  <datalist id="finale-subject-options">
                    {FINALE_SUBJECT_SUGGESTIONS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-400">Difficulty:</label>
                  <select
                    disabled={isFrozen}
                    value={curQ.difficulty}
                    onChange={(e) => updateQuestionSlot(curIdx, { difficulty: e.target.value as FinaleDifficulty })}
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 outline-none disabled:opacity-60"
                  >
                    {FINALE_DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">
                Question Text (Clinical Vignette) <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={4}
                disabled={isFrozen}
                value={curQ.question}
                onChange={(e) => updateQuestionSlot(curIdx, { question: e.target.value })}
                placeholder="Enter the clinical scenario or rapid-fire question..."
                className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-white text-sm focus:border-amber-500 outline-none resize-none disabled:opacity-60"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["A", "B", "C", "D"] as const).map((letter) => {
                const optKey = `option_${letter.toLowerCase()}` as "option_a" | "option_b" | "option_c" | "option_d";
                const isCorrect = curQ.correct_answer === letter;
                return (
                  <div
                    key={letter}
                    className={`p-4 rounded-2xl border transition ${
                      isCorrect ? "bg-amber-500/10 border-amber-500/50" : "bg-slate-950/80 border-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black text-amber-400">
                        Option {letter} <span className="text-rose-400">*</span>
                      </span>
                      <button
                        type="button"
                        disabled={isFrozen}
                        onClick={() => updateQuestionSlot(curIdx, { correct_answer: letter })}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                          isCorrect ? "bg-amber-500 text-slate-950 font-black" : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {isCorrect ? "✓ Correct Answer" : "Mark Correct"}
                      </button>
                    </div>
                    <input
                      type="text"
                      disabled={isFrozen}
                      value={curQ[optKey]}
                      onChange={(e) => updateQuestionSlot(curIdx, { [optKey]: e.target.value })}
                      placeholder={`Option ${letter} text...`}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:border-amber-500 outline-none disabled:opacity-60"
                    />
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">
                Faculty Explanation &amp; Reference (Shown After Submission) <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={3}
                disabled={isFrozen}
                value={curQ.explanation}
                onChange={(e) => updateQuestionSlot(curIdx, { explanation: e.target.value })}
                placeholder="Required clinical rationale and authoritative explanation displayed to contestants after final submit..."
                className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-white text-sm focus:border-amber-500 outline-none resize-none disabled:opacity-60"
              />
            </div>

            {FINALE_QUESTION_COUNT > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
                <span>
                  Slot completion: <strong className={isSlotComplete(curQ) ? "text-emerald-400" : "text-amber-300"}>
                    {isSlotComplete(curQ) ? "Complete" : "Missing required fields"}
                  </strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeSlot <= 1}
                    onClick={() => setActiveSlot((s) => Math.max(1, s - 1))}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Prev Slot
                  </button>
                  <button
                    type="button"
                    disabled={activeSlot >= FINALE_QUESTION_COUNT}
                    onClick={() => setActiveSlot((s) => Math.min(FINALE_QUESTION_COUNT, s + 1))}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Next Slot
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SUB-TAB 2: OFFICIAL ROSTER & LIVE SESSIONS MONITOR ─────────────────── */}
      {subTab === "roster" && (
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-base font-bold text-white">Approved Grand Finale Roster ({rosterList.length}/10 Finalists)</h4>
              <p className="text-xs text-slate-400">
                Verified from <span className="font-mono text-amber-400">championship_finale_approved_roster</span> with live session &amp; device state
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadOverview(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Seat</th>
                  <th className="py-3 px-4">Finalist</th>
                  <th className="py-3 px-4">College &amp; Batch</th>
                  <th className="py-3 px-4">Session</th>
                  <th className="py-3 px-4">Device</th>
                  <th className="py-3 px-4">Official Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rosterList.map((r) => (
                  <tr key={r.seatNumber} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">Seat #{r.seatNumber}</td>
                    <td className="py-3 px-4 font-semibold text-white">{r.studentName}</td>
                    <td className="py-3 px-4 text-slate-300">
                      <div>{r.college}</div>
                      <div className="text-[11px] font-mono text-slate-500">{r.batch}</div>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {r.sessionStatus === "submitted" ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">SUBMITTED</span>
                      ) : r.sessionStatus === "active" ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">ACTIVE</span>
                      ) : r.sessionStatus === "expired" ? (
                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">EXPIRED</span>
                      ) : (
                        <span className="text-slate-500">Not Started</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {r.deviceBound ? (
                        <span className="text-emerald-400">Locked</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {r.attemptScore !== null ? (
                        <span className="text-emerald-400 font-bold">
                          {r.attemptScore}/1000 ({Number(r.attemptElapsedSeconds || 0).toFixed(1)}s)
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SUB-TAB 3: CLASSIC CREW ISOLATED TEST ACCESS & DEVICES ─────────────── */}
      {subTab === "tester" && (
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-slate-900/80 border border-indigo-500/30 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold uppercase tracking-wider">
                  <FlaskConical className="w-3.5 h-3.5" />
                  Isolated Test Participant (Non-Roster)
                </div>
                <h4 className="text-base font-bold text-white">
                  {testerInfo ? `${testerInfo.displayName} (${testerInfo.email})` : "Classic crew (dpsvsambbs@gmail.com)"}
                </h4>
                <p className="text-xs text-slate-400">
                  Test attempts use <span className="font-mono text-indigo-300">is_test = true</span> &amp; <span className="font-mono text-indigo-300">seat_number = 0</span>. Excluded from official standings, roster seats, and freeze lock.
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetTestSessions}
                disabled={actionBusy === "reset_test"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${actionBusy === "reset_test" ? "animate-spin" : ""}`} />
                <span>Reset Active Test Session</span>
              </button>
            </div>

            {/* Manually pre-approve a test device ID */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Laptop className="w-4 h-4 text-indigo-400" />
                Pre-Authorize or Approve Classic Crew Test Device
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={manualDeviceId}
                  onChange={(e) => setManualDeviceId(e.target.value)}
                  placeholder="Paste Device ID (dev_...) from tester's modal"
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-mono outline-none focus:border-indigo-500"
                />
                <input
                  type="text"
                  value={manualDeviceLabel}
                  onChange={(e) => setManualDeviceLabel(e.target.value)}
                  placeholder="Device label (e.g. Organiser Laptop)"
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  disabled={deviceBusyId !== null || manualDeviceId.trim().length < 8}
                  onClick={() => handleDeviceAction(manualDeviceId, "approve", manualDeviceLabel)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-40"
                >
                  Authorize Device ID
                </button>
              </div>
            </div>

            {/* Registered & Authorized Devices Table */}
            <div className="space-y-2">
              <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Test Devices ({testerInfo?.devices.length || 0})
              </h5>
              {!testerInfo || testerInfo.devices.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
                  No test devices registered yet. Classic crew can click &ldquo;Register This Device&rdquo; from the Championship page or you can paste a Device ID above.
                </div>
              ) : (
                <div className="space-y-2">
                  {testerInfo.devices.map((d) => (
                    <div
                      key={d.deviceId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-950 border border-slate-800"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{d.deviceLabel || "Browser Test Device"}</span>
                          {d.isAuthorized && !d.revokedAt ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                              AUTHORIZED
                            </span>
                          ) : d.revokedAt ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                              REVOKED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                              PENDING APPROVAL
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate">ID: {d.deviceId}</div>
                        <div className="text-[10px] text-slate-500">Last seen: {formatShortIST(d.lastSeenAt)}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(!d.isAuthorized || d.revokedAt) && (
                          <button
                            type="button"
                            disabled={deviceBusyId === d.deviceId}
                            onClick={() => handleDeviceAction(d.deviceId, "approve")}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                        )}
                        {d.isAuthorized && !d.revokedAt && (
                          <button
                            type="button"
                            disabled={deviceBusyId === d.deviceId}
                            onClick={() => handleDeviceAction(d.deviceId, "revoke")}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Test Attempt History */}
            <div className="space-y-2 pt-2">
              <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Isolated Test Run History ({testerInfo?.attempts.length || 0})
              </h5>
              {!testerInfo || testerInfo.attempts.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
                  No Classic crew test submissions recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Flag</th>
                        <th className="py-2.5 px-3">Score</th>
                        <th className="py-2.5 px-3">Accuracy</th>
                        <th className="py-2.5 px-3">Elapsed</th>
                        <th className="py-2.5 px-3">Device</th>
                        <th className="py-2.5 px-3">Submitted At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {testerInfo.attempts.map((ta) => (
                        <tr key={ta.id}>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[10px] font-bold">
                              is_test = true
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-white">{ta.score} / 1000</td>
                          <td className="py-2.5 px-3 font-mono text-blue-300">{ta.accuracy}%</td>
                          <td className="py-2.5 px-3 font-mono">{ta.elapsedSeconds.toFixed(2)}s</td>
                          <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">{ta.deviceId || "—"}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">{formatShortIST(ta.submittedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SUB-TAB 4: OFFICIAL STANDINGS ──────────────────────────────────────── */}
      {subTab === "leaderboard" && (
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-base font-bold text-white">Official Grand Finale Standings</h4>
              <p className="text-xs text-slate-400">
                Ranked strictly from approved finalists (score DESC, accuracy DESC, elapsed ASC) — test attempts excluded
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadOverview(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          {leaderboardList.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800/80 text-slate-400 space-y-2">
              <Award className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">No Official Submissions Recorded Yet</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Standings populate automatically as approved finalists complete their 90-second attempt during the LIVE Finale.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Seat</th>
                    <th className="py-3 px-4">Finalist</th>
                    <th className="py-3 px-4">College</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Accuracy</th>
                    <th className="py-3 px-4">Time Taken</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {leaderboardList.map((lb) => (
                    <tr key={lb.seatNumber} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">#{lb.rank}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">Seat #{lb.seatNumber}</td>
                      <td className="py-3 px-4 font-semibold text-white">{lb.studentName}</td>
                      <td className="py-3 px-4 text-slate-300">{lb.college}</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">{lb.score} / 1000</td>
                      <td className="py-3 px-4 font-mono text-blue-400">{lb.accuracy}%</td>
                      <td className="py-3 px-4 font-mono text-slate-300">{Number(lb.elapsedSeconds).toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── CONFIRMATION MODALS (GO LIVE / END FINALE) ─────────────────────────── */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div
            className={`w-full max-w-md rounded-3xl bg-slate-900 p-6 sm:p-8 space-y-5 shadow-2xl border ${
              confirmAction === "go_live" ? "border-emerald-500/40" : "border-rose-500/40"
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                confirmAction === "go_live"
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                  : "bg-rose-500/20 border-rose-500/40 text-rose-400"
              }`}
            >
              {confirmAction === "go_live" ? <Play className="w-6 h-6 fill-emerald-400" /> : <Clock className="w-6 h-6" />}
            </div>

            {confirmAction === "go_live" ? (
              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-white">Confirm Go Live Grand Finale</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  All 10 published questions will become <strong>permanently frozen</strong> and the 90-second Rapid Fire examination will open immediately for the 10 approved finalists on <span className="font-mono">/championship</span>. Daily Pulse remains untouched.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-white">Confirm End Grand Finale</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  This transitions the Finale status to <strong>ENDED</strong>, immediately closes any remaining active sessions, and rejects all further submissions.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={confirmAction === "go_live" ? handleGoLiveConfirmed : handleEndFinaleConfirmed}
                className={`flex-1 py-3 rounded-xl text-white font-black text-xs uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                  confirmAction === "go_live"
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30"
                    : "bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/30"
                }`}
              >
                <Check className="w-4 h-4" />
                <span>{confirmAction === "go_live" ? "Yes, Go Live Now" : "Yes, End Finale"}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
