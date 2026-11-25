import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Award,
  Check,
  CheckCircle2,
  Clock,
  CopyPlus,
  Eraser,
  FileEdit,
  FlaskConical,
  Laptop,
  Loader2,
  Lock,
  Play,
  PlusCircle,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  ShieldOff,
  Square,
  Trophy,
  Unlock,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  createEmptyFinaleQuestions,
  createNewFinaleSession,
  CURRENT_FINALE_CODE,
  endFinale,
  fetchFinaleAdminOverview,
  fetchFinaleSessionSummary,
  FINALE_DIFFICULTIES,
  FINALE_QUESTION_COUNT,
  getTotalFinalePoints,
  goLiveFinale,
  manageFinaleTestDevice,
  publishFinaleSet,
  resetFinaleSession,
  resetFinaleTestSessions,
  subscribeToFinalePublicState,
  unlockFinaleForEdit,
  validateFinaleQuestionsForPublish,
  type FinaleAdminOverview,
  type FinaleDifficulty,
  type FinaleLifecycleStatus,
  type FinaleQuestionAdminInput,
  type FinaleSessionSummary,
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
    FINALE_DIFFICULTIES.includes(q.difficulty) &&
    Number.isInteger(q.points) &&
    q.points >= 1 &&
    q.points <= 1000
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

type ConfirmActionType =
  | "go_live"
  | "end"
  | "new_session_blank"
  | "new_session_copy"
  | "reset_current_session"
  | "clear_standings";

export function FinaleFormatBOps() {
  const [subTab, setSubTab] = useState<"questions" | "roster" | "tester" | "leaderboard" | "archives">("questions");
  const [overview, setOverview] = useState<FinaleAdminOverview | null>(null);
  const [questions, setQuestions] = useState<FinaleQuestionAdminInput[]>(createEmptyFinaleQuestions());
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<
    "draft" | "validate" | "publish" | "go_live" | "end" | "reset_test" | "session_mgmt" | null
  >(null);
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionType | null>(null);
  const [confirmSummary, setConfirmSummary] = useState<FinaleSessionSummary | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmAckChecked, setConfirmAckChecked] = useState(false);
  const [manualDeviceId, setManualDeviceId] = useState("");
  const [manualDeviceLabel, setManualDeviceLabel] = useState("");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const loadOverview = useCallback(async (preserveEdits: boolean = false) => {
    setLoading(true);
    try {
      const res = await fetchFinaleAdminOverview(CURRENT_FINALE_CODE);
      if (!res.success) {
        setBannerError(res.error || "Could not load Grand Finale Ops state from Supabase.");
      } else {
        setBannerError(null);
        setOverview(res);
        if (!preserveEdits) {
          if (res.set && res.set.questions.length > 0) {
            setQuestions(res.set.questions);
          } else {
            setQuestions(createEmptyFinaleQuestions());
          }
          setHasUnsavedEdits(false);
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
    const unsub = subscribeToFinalePublicState(CURRENT_FINALE_CODE, () => {
      loadOverview(false);
    });
    return () => {
      unsub();
    };
  }, [loadOverview]);

  const activeCode = overview?.set?.finaleCode || overview?.finaleCode || CURRENT_FINALE_CODE;
  const sessionNumber = overview?.set?.sessionNumber || overview?.sessionNumber || 1;
  const serverStatus: FinaleLifecycleStatus | "not_created" = overview?.set?.status || "not_created";
  const isFrozen =
    Boolean(overview?.set?.questionsFrozen) ||
    serverStatus === "live" ||
    serverStatus === "ended" ||
    serverStatus === "archived" ||
    serverStatus === "closed";
  const completedCount = questions.filter(isSlotComplete).length;
  const totalMaxPoints = getTotalFinalePoints(questions);

  const updateQuestionSlot = (slotIdx: number, patch: Partial<FinaleQuestionAdminInput>) => {
    if (isFrozen) {
      toast.error("This session is frozen/completed. Click EDIT QUESTIONS or START NEW FINALE SESSION to unlock an editable copy.");
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
        points: 100,
      };
      const base: FinaleQuestionAdminInput = next[slotIdx] ?? fallback;
      next[slotIdx] = { ...base, ...patch, slot: slotIdx + 1 };
      return next;
    });
  };

  const openSafetyConfirm = async (action: ConfirmActionType) => {
    setConfirmAckChecked(false);
    setConfirmAction(action);
    if (action === "go_live" || action === "end") {
      setConfirmSummary(null);
      return;
    }
    setConfirmLoading(true);
    try {
      const sum = await fetchFinaleSessionSummary(activeCode);
      setConfirmSummary(sum);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (isFrozen) {
      toast.error("Cannot modify frozen/ended session directly. Start a New Session to edit.");
      return;
    }
    setActionBusy("draft");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await publishFinaleSet({
        finaleCode: activeCode,
        questions,
        status: "draft",
        title: overview?.set?.title || `MedTrail Championship Grand Finale — Session ${sessionNumber}`,
      });
      if (!res.success) {
        setBannerError(res.error || "Failed to save Grand Finale draft.");
        toast.error(res.error || "Failed to save Grand Finale draft.");
        return;
      }
      setHasUnsavedEdits(false);
      setBannerSuccess(`Session #${sessionNumber} draft saved cleanly. Students cannot see questions yet.`);
      toast.success("Grand Finale draft saved.");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handleValidateSet = async () => {
    if (isFrozen) {
      toast.error("Session is frozen. Start a New Session to edit and validate.");
      return;
    }
    const check = validateFinaleQuestionsForPublish(questions);
    if (!check.valid) {
      if (check.firstInvalidSlot) setActiveSlot(check.firstInvalidSlot);
      setBannerError(check.error || "Fix incomplete fields before validating.");
      toast.error(check.error || "Fix incomplete fields before validating.");
      return;
    }
    setActionBusy("validate");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await publishFinaleSet({
        finaleCode: activeCode,
        questions,
        status: "validated",
        title: overview?.set?.title || `MedTrail Championship Grand Finale — Session ${sessionNumber}`,
      });
      if (!res.success) {
        setBannerError(res.error || "Validation failed.");
        toast.error(res.error || "Validation failed.");
        return;
      }
      setHasUnsavedEdits(false);
      setBannerSuccess(`Session #${sessionNumber} VALIDATED (10/10 slots, ${totalMaxPoints} max pts). Click PUBLISH 10 QUESTIONS when ready.`);
      toast.success("10/10 questions validated!");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handlePublish = async () => {
    if (isFrozen) {
      toast.error("Cannot re-publish frozen session. Start a New Session to publish updates.");
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
        finaleCode: activeCode,
        questions,
        status: "published",
        title: overview?.set?.title || `MedTrail Championship Grand Finale — Session ${sessionNumber}`,
      });
      if (!res.success) {
        setBannerError(res.error || "Publish failed.");
        toast.error(res.error || "Publish failed.");
        return;
      }
      setHasUnsavedEdits(false);
      setBannerSuccess(
        `Session #${sessionNumber} PUBLISHED (Waiting Room). Finalists stay in the Waiting Screen until you click GO LIVE FINALE.`
      );
      toast.success("10 questions published! Click Go Live Finale when ready.");
      await loadOverview(false);
    } finally {
      setActionBusy(null);
    }
  };

  const handleEditQuestions = async () => {
    setActionBusy("session_mgmt");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const res = await unlockFinaleForEdit(activeCode);
      if (res.success) {
        setSubTab("questions");
        setBannerSuccess(`Session #${sessionNumber} unlocked to DRAFT for question editing.`);
        toast.success("Questions unlocked for editing.");
        await loadOverview(false);
        return;
      }
      if (res.requiresNewSession) {
        await openSafetyConfirm("new_session_copy");
        return;
      }
      setBannerError(res.error || "Could not unlock questions.");
      toast.error(res.error || "Could not unlock questions.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmAction = async () => {
    const action = confirmAction;
    if (!action) return;
    if (action !== "go_live" && action !== "end" && !confirmAckChecked) {
      toast.error("Please check the confirmation box first.");
      return;
    }
    setConfirmAction(null);
    setBannerError(null);
    setBannerSuccess(null);

    if (action === "go_live") {
      if (hasUnsavedEdits) {
        const msg = "You have unsaved editor changes. Publish the 10 questions before going live.";
        setBannerError(msg);
        toast.error(msg);
        return;
      }
      setActionBusy("go_live");
      try {
        const res = await goLiveFinale(activeCode);
        if (!res.success) {
          setBannerError(res.error || "Failed to Go Live.");
          toast.error(res.error || "Failed to Go Live.");
          return;
        }
        setBannerSuccess(`Session #${sessionNumber} is LIVE! Questions are locked for participants and the 90s arena is open.`);
        toast.success("Grand Finale is now LIVE!");
        await loadOverview(false);
      } finally {
        setActionBusy(null);
      }
      return;
    }

    if (action === "end") {
      setActionBusy("end");
      try {
        const res = await endFinale(activeCode);
        if (!res.success) {
          setBannerError(res.error || "Failed to End Finale.");
          toast.error(res.error || "Failed to End Finale.");
          return;
        }
        const expNote =
          typeof res.expiredSessions === "number" && res.expiredSessions > 0
            ? ` (${res.expiredSessions} active session(s) expired)`
            : "";
        setBannerSuccess(`Session #${sessionNumber} ENDED${expNote}. Click START NEW FINALE SESSION when ready for the next round.`);
        toast.success("Grand Finale ended.");
        await loadOverview(false);
      } finally {
        setActionBusy(null);
      }
      return;
    }

    setActionBusy("session_mgmt");
    try {
      if (action === "new_session_blank" || action === "new_session_copy") {
        const copyQ = action === "new_session_copy";
        const res = await createNewFinaleSession({
          copyQuestions: copyQ,
          reason: copyQ
            ? "Admin archived session and cloned questions into editable draft"
            : "Admin archived session and created fresh blank session",
        });
        if (!res.success) {
          setBannerError(res.error || "Failed to start new Finale session.");
          toast.error(res.error || "Failed to start new Finale session.");
          return;
        }
        setSubTab("questions");
        setActiveSlot(1);
        setBannerSuccess(
          `Session #${res.sessionNumber} created cleanly (${copyQ ? "10 questions cloned to editable draft" : "blank 10-slot draft"}). Previous results safely archived (${res.archivedSubmissions ?? 0} official submission(s) preserved).`
        );
        toast.success(`Started Session #${res.sessionNumber}!`);
        await loadOverview(false);
        return;
      }

      if (action === "reset_current_session" || action === "clear_standings") {
        const clearQuestions = action === "reset_current_session";
        const res = await resetFinaleSession({
          finaleCode: activeCode,
          clearQuestions,
        });
        if (!res.success) {
          setBannerError(res.error || "Reset failed.");
          toast.error(res.error || "Reset failed.");
          return;
        }
        setSubTab("questions");
        setActiveSlot(1);
        setBannerSuccess(
          res.archived
            ? `Archived ${res.affectedSubmissions ?? 0} submission(s) safely and activated fresh zero-standings Session #${res.sessionNumber} (${clearQuestions ? "blank draft" : "10 questions preserved for editing"}).`
            : `Pre-live session reset cleanly to DRAFT (${clearQuestions ? "questions cleared" : "questions preserved"}).`
        );
        toast.success(clearQuestions ? "Current session reset cleanly." : "Session standings cleared and previous results archived.");
        await loadOverview(false);
      }
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
      const res = await resetFinaleTestSessions(activeCode);
      if (!res.success) {
        toast.error(res.error || "Could not reset active test sessions.");
        return;
      }
      toast.success("Active Classic crew test session(s) cleared.");
      await loadOverview(true);
    } finally {
      setActionBusy(null);
    }
  };

  const defaultStatusBadge = { label: "DRAFT", cls: "bg-slate-800 text-amber-300 border-amber-500/30" };
  const statusMeta: Record<string, { label: string; cls: string }> = {
    not_created: { label: "DRAFT (NOT SAVED)", cls: "bg-slate-800 text-slate-300 border-slate-700" },
    draft: defaultStatusBadge,
    validated: { label: "VALIDATED • READY TO PUBLISH", cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" },
    published: { label: "PUBLISHED • WAITING ROOM", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
    live: { label: "LIVE • 90s ARENA OPEN", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 animate-pulse" },
    ended: { label: "ENDED • READY FOR NEXT SESSION", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
    archived: { label: "ARCHIVED", cls: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
    closed: { label: "ENDED • SUBMISSIONS CLOSED", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  };
  const activeStatusBadge = statusMeta[serverStatus] ?? defaultStatusBadge;

  const rosterList = overview?.roster || [];
  const leaderboardList = overview?.leaderboard || [];
  const archivesList = overview?.archives || [];
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
    points: 100,
  };
  const curQ: FinaleQuestionAdminInput = questions[curIdx] ?? fallbackQ;

  return (
    <div className="space-y-6 pt-2">
      {/* ── FINALE SESSION MANAGEMENT DECK ──────────────────────────────────── */}
      <div className="p-6 rounded-3xl bg-slate-900/90 border border-amber-500/35 shadow-xl space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-black uppercase tracking-wider">
                <Trophy className="w-3.5 h-3.5" />
                FINALE SESSION MANAGEMENT
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs font-bold">
                Session #{sessionNumber}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-black uppercase tracking-wider ${activeStatusBadge.cls}`}>
                <Radio className="w-3.5 h-3.5" />
                {activeStatusBadge.label}
              </span>
              {isFrozen && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold">
                  <Lock className="w-3 h-3" />
                  Archived/Session Bank Locked
                </span>
              )}
            </div>
            <h3 className="text-xl font-black text-white">
              Reusable Grand Finale Ops &amp; Multi-Session Control
            </h3>
            <p className="text-xs text-slate-400">
              Active Session Code: <span className="font-mono text-slate-200">{activeCode}</span> &bull; Max Score:{" "}
              <span className="font-mono text-amber-300">{totalMaxPoints} pts</span> &bull; Lifecycle:{" "}
              <span className="text-slate-200 font-semibold">DRAFT → VALIDATED → PUBLISHED → LIVE → ENDED → ARCHIVED</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadOverview(hasUnsavedEdits)}
            disabled={loading || actionBusy !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer disabled:opacity-50 w-fit"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Sync Server</span>
          </button>
        </div>

        {/* Ended Session Prominent Restart Banner */}
        {(serverStatus === "ended" || serverStatus === "archived" || serverStatus === "closed") && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-amber-950/60 border border-amber-500/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Session #{sessionNumber} Completed ({leaderboardList.length} official ranking(s))
              </div>
              <p className="text-xs text-slate-300">
                Start the next Grand Finale round cleanly. Session #{sessionNumber}&rsquo;s questions and standings are preserved permanently in the Archive.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => openSafetyConfirm("new_session_copy")}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/25 disabled:opacity-40"
              >
                <CopyPlus className="w-4 h-4" />
                <span>START NEW FINALE SESSION (Clone Qs)</span>
              </button>
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => openSafetyConfirm("new_session_blank")}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer disabled:opacity-40"
              >
                <PlusCircle className="w-4 h-4" />
                <span>START NEW FINALE SESSION (Blank)</span>
              </button>
            </div>
          </div>
        )}

        {/* Primary Session Management & Lifecycle Action Buttons */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
            Session Lifecycle &amp; Reset Controls (Server-Authorized)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => openSafetyConfirm("new_session_blank")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 border border-indigo-500/40 text-xs font-bold transition cursor-pointer disabled:opacity-40"
            >
              <PlusCircle className="w-3.5 h-3.5 text-indigo-300" />
              <span>NEW SESSION</span>
            </button>

            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => openSafetyConfirm("reset_current_session")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-bold transition cursor-pointer disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span>RESET CURRENT SESSION</span>
            </button>

            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={handleEditQuestions}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-200 border border-amber-500/35 text-xs font-bold transition cursor-pointer disabled:opacity-40"
            >
              <Unlock className="w-3.5 h-3.5 text-amber-400" />
              <span>EDIT QUESTIONS</span>
            </button>

            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => openSafetyConfirm("clear_standings")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 text-xs font-bold transition cursor-pointer disabled:opacity-40"
            >
              <Eraser className="w-3.5 h-3.5 text-amber-400" />
              <span>CLEAR SESSION STANDINGS</span>
            </button>

            <div className="h-6 w-px bg-slate-800 hidden sm:block mx-1" />

            <button
              type="button"
              disabled={isFrozen || actionBusy !== null}
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "draft" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-slate-400" />}
              <span>{actionBusy === "draft" ? "Saving..." : "SAVE NEW DRAFT"}</span>
            </button>

            <button
              type="button"
              disabled={isFrozen || actionBusy !== null}
              onClick={handleValidateSet}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600/25 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "validate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />}
              <span>VALIDATE ({completedCount}/10)</span>
            </button>

            <button
              type="button"
              disabled={isFrozen || actionBusy !== null}
              onClick={handlePublish}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "publish" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{actionBusy === "publish" ? "Publishing..." : `PUBLISH 10 QUESTIONS`}</span>
            </button>

            <button
              type="button"
              disabled={serverStatus !== "published" || hasUnsavedEdits || actionBusy !== null}
              onClick={() => openSafetyConfirm("go_live")}
              title={
                hasUnsavedEdits
                  ? "Publish your latest edits before going live"
                  : serverStatus !== "published"
                  ? "Requires status = PUBLISHED"
                  : "Start the LIVE 90s Finale"
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "go_live" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
              <span>{actionBusy === "go_live" ? "Starting..." : "GO LIVE FINALE"}</span>
            </button>

            <button
              type="button"
              disabled={serverStatus !== "live" || actionBusy !== null}
              onClick={() => openSafetyConfirm("end")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-lg shadow-rose-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionBusy === "end" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-white" />}
              <span>{actionBusy === "end" ? "Ending..." : "END FINALE"}</span>
            </button>
          </div>
        </div>

        {/* 6-Stage Reusable Lifecycle Stepper */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 pt-1">
          {[
            {
              step: "1. Draft",
              active: serverStatus === "draft" || serverStatus === "not_created",
              done: ["validated", "published", "live", "ended", "archived", "closed"].includes(serverStatus),
              detail: `${completedCount}/10 ready`,
            },
            {
              step: "2. Validated",
              active: serverStatus === "validated",
              done: ["published", "live", "ended", "archived", "closed"].includes(serverStatus),
              detail: `${totalMaxPoints} max pts`,
            },
            {
              step: "3. Published",
              active: serverStatus === "published",
              done: ["live", "ended", "archived", "closed"].includes(serverStatus),
              detail: overview?.set?.publishedAt ? formatShortIST(overview.set.publishedAt) : "Waiting Room",
            },
            {
              step: "4. Live (90s)",
              active: serverStatus === "live",
              done: ["ended", "archived", "closed"].includes(serverStatus),
              detail: overview?.set?.liveStartedAt ? formatShortIST(overview.set.liveStartedAt) : "Arena Locked",
            },
            {
              step: "5. Ended",
              active: serverStatus === "ended" || serverStatus === "closed",
              done: serverStatus === "archived",
              detail: overview?.set?.endedAt ? formatShortIST(overview.set.endedAt) : "Pending End",
            },
            {
              step: "6. Archived",
              active: serverStatus === "archived",
              done: archivesList.length > 0,
              detail: `${archivesList.length} archived`,
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`p-2.5 rounded-2xl border text-xs ${
                item.active
                  ? "bg-amber-500/15 border-amber-500/50 text-white"
                  : item.done
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-slate-950/70 border-slate-800 text-slate-400"
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>{item.step}</span>
                {item.done && !item.active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
              </div>
              <div className="text-[10px] opacity-80 font-mono mt-1 truncate">{item.detail}</div>
            </div>
          ))}
        </div>

        {hasUnsavedEdits && !isFrozen && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              You have unpublished local changes for Session #{sessionNumber}. Click <strong>SAVE NEW DRAFT</strong>, <strong>VALIDATE</strong>, or <strong>PUBLISH 10 QUESTIONS</strong>.
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
            { id: "leaderboard", label: `Session #${sessionNumber} Standings (${leaderboardList.length})`, icon: Award },
            { id: "archives", label: `Archived Sessions (${archivesList.length})`, icon: Archive },
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
                  <span className={`w-2 h-2 rounded-full ${complete ? "bg-emerald-400" : partial ? "bg-amber-400" : "bg-slate-700"}`} />
                </button>
              );
            })}
          </div>

          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-6">
            {isFrozen && (
              <div className="p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-indigo-200">
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>
                    Session #{sessionNumber} questions are immutable to preserve live/completed integrity. Start a new session to unlock editing without altering history.
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => openSafetyConfirm("new_session_copy")}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase tracking-wider transition cursor-pointer shrink-0"
                >
                  Archive &amp; Clone to New Editable Session
                </button>
              </div>
            )}

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-black text-sm">
                  {activeSlot}
                </span>
                <div>
                  <h4 className="text-base font-bold text-white flex items-center gap-2">
                    Session #{sessionNumber} · Slot #{activeSlot}
                    {isFrozen && <Lock className="w-3.5 h-3.5 text-indigo-400" />}
                  </h4>
                  <span className="text-xs text-slate-400">{curQ.points} pts &bull; Shared 90-second timer</span>
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
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 outline-none w-40 disabled:opacity-60"
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

                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-400">Points:</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={10}
                    disabled={isFrozen}
                    value={curQ.points}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      updateQuestionSlot(curIdx, { points: Number.isNaN(val) ? 100 : Math.max(1, Math.min(1000, val)) });
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-amber-300 font-mono font-bold text-xs focus:border-amber-500 outline-none w-20 disabled:opacity-60"
                  />
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
                  Slot completion:{" "}
                  <strong className={isSlotComplete(curQ) ? "text-emerald-400" : "text-amber-300"}>
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
                Live telemetry scoped strictly to <span className="font-mono text-amber-400">Session #{sessionNumber}</span> ({activeCode})
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
                  <th className="py-3 px-4">Session #{sessionNumber}</th>
                  <th className="py-3 px-4">Device</th>
                  <th className="py-3 px-4">Session Score</th>
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
                      {r.deviceBound ? <span className="text-emerald-400">Locked</span> : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {r.attemptScore !== null ? (
                        <span className="text-emerald-400 font-bold">
                          {r.attemptScore}/{totalMaxPoints} ({Number(r.attemptElapsedSeconds || 0).toFixed(1)}s)
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

            <div className="space-y-2">
              <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Test Devices ({testerInfo?.devices.length || 0})
              </h5>
              {!testerInfo || testerInfo.devices.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
                  No test devices registered yet.
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

            <div className="space-y-2 pt-2">
              <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Session #{sessionNumber} Test Run History ({testerInfo?.attempts.length || 0})
              </h5>
              {!testerInfo || testerInfo.attempts.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
                  No Classic crew test submissions recorded in Session #{sessionNumber} yet.
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
                          <td className="py-2.5 px-3 font-mono font-bold text-white">{ta.score} / {totalMaxPoints}</td>
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

      {/* ── SUB-TAB 4: CURRENT SESSION OFFICIAL STANDINGS ──────────────────────── */}
      {subTab === "leaderboard" && (
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-white">Session #{sessionNumber} Official Standings</h4>
              <p className="text-xs text-slate-400">
                Isolated to <span className="font-mono text-amber-300">{activeCode}</span> (score DESC, accuracy DESC, elapsed ASC)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openSafetyConfirm("clear_standings")}
                className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-bold border border-amber-500/40 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Clear Session Standings</span>
              </button>
              <button
                type="button"
                onClick={() => loadOverview(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {leaderboardList.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800/80 text-slate-400 space-y-2">
              <Award className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">No Official Submissions in Session #{sessionNumber}</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Standings start cleanly at zero for each new session and exclude Classic Crew test attempts.
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
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">{lb.score} / {totalMaxPoints}</td>
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

      {/* ── SUB-TAB 5: IMMUTABLE ARCHIVED SESSIONS ─────────────────────────────── */}
      {subTab === "archives" && (
        <div className="space-y-4">
          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h4 className="text-base font-bold text-white">Immutable Archived Sessions ({archivesList.length})</h4>
              <p className="text-xs text-slate-400">
                Historical results and question banks preserved cleanly whenever sessions end, reset, or restart.
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

          {archivesList.length === 0 ? (
            <div className="p-10 text-center rounded-3xl bg-slate-900/60 border border-slate-800 text-slate-400 space-y-2">
              <Archive className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">No Archived Sessions Yet</p>
              <p className="text-xs text-slate-500">
                Completed sessions appear here automatically when you reset standings or start a new Finale session.
              </p>
            </div>
          ) : (
            archivesList.map((arch) => (
              <div key={arch.finaleCode} className="p-6 rounded-3xl bg-slate-900/80 border border-purple-500/30 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono text-xs font-bold">
                        Session #{arch.sessionNumber}
                      </span>
                      <span className="font-mono text-xs text-slate-400">{arch.finaleCode}</span>
                      <span className="text-[11px] text-slate-400">Archived {formatShortIST(arch.archivedAt)}</span>
                    </div>
                    <h5 className="text-base font-bold text-white mt-1">{arch.title}</h5>
                    {arch.archiveReason && <p className="text-[11px] text-slate-400">{arch.archiveReason}</p>}
                  </div>
                  <div className="text-right font-mono text-xs text-slate-300 shrink-0">
                    <div>{arch.submissionCount} Official Submission(s)</div>
                    <div className="text-[11px] text-slate-500">{arch.participantCount} Participant(s)</div>
                  </div>
                </div>

                {arch.standings.length === 0 ? (
                  <p className="text-xs text-slate-400">Zero official standings recorded in this archived session.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Rank</th>
                          <th className="py-2 px-3">Seat</th>
                          <th className="py-2 px-3">Finalist</th>
                          <th className="py-2 px-3">Score</th>
                          <th className="py-2 px-3">Accuracy</th>
                          <th className="py-2 px-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {arch.standings.map((lb) => (
                          <tr key={`${arch.finaleCode}_${lb.seatNumber}`}>
                            <td className="py-2 px-3 font-mono font-bold text-amber-400">#{lb.rank}</td>
                            <td className="py-2 px-3 font-mono text-slate-400">Seat #{lb.seatNumber}</td>
                            <td className="py-2 px-3 font-semibold text-white">{lb.studentName}</td>
                            <td className="py-2 px-3 font-mono font-bold text-emerald-400">{lb.score}</td>
                            <td className="py-2 px-3 font-mono text-blue-300">{lb.accuracy}%</td>
                            <td className="py-2 px-3 font-mono">{Number(lb.elapsedSeconds).toFixed(2)}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── CONFIRMATION MODAL (SESSION SAFETY & LIFECYCLE) ────────────────────── */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div
            className={`w-full max-w-lg rounded-3xl bg-slate-900 p-6 sm:p-8 space-y-5 shadow-2xl border ${
              confirmAction === "go_live"
                ? "border-emerald-500/40"
                : confirmAction === "end" || confirmAction === "reset_current_session"
                ? "border-rose-500/40"
                : "border-amber-500/40"
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                confirmAction === "go_live"
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                  : confirmAction === "end" || confirmAction === "reset_current_session"
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-400"
                  : "bg-amber-500/20 border-amber-500/40 text-amber-400"
              }`}
            >
              {confirmAction === "go_live" ? (
                <Play className="w-6 h-6 fill-emerald-400" />
              ) : confirmAction === "end" ? (
                <Clock className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>

            {confirmAction === "go_live" ? (
              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-white">Confirm Go Live — Session #{sessionNumber}</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  All 10 published questions will lock for participants and the 90-second Rapid Fire examination will open immediately for the 10 approved finalists. Daily Pulse remains untouched.
                </p>
              </div>
            ) : confirmAction === "end" ? (
              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-white">Confirm End Finale — Session #{sessionNumber}</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Transitions Session #{sessionNumber} to <strong>ENDED</strong>, immediately closes any remaining active participant sessions, and rejects further submissions. You can archive &amp; start Session #{sessionNumber + 1} immediately afterwards.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-xl font-black text-white">
                  {confirmAction === "clear_standings"
                    ? "Confirm Clear Session Standings"
                    : confirmAction === "reset_current_session"
                    ? "Confirm Reset Current Session"
                    : "Confirm Start New Finale Session"}
                </h3>

                {confirmLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking live participant &amp; submission impact…</span>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Target Session:</span>
                      <span className="font-mono font-bold text-white">
                        Session #{confirmSummary?.sessionNumber ?? sessionNumber} ({confirmSummary?.finaleCode ?? activeCode})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Official Participants Affected:</span>
                      <span className="font-mono font-bold text-amber-300">
                        {confirmSummary?.officialParticipantCount ?? 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Official Submissions Affected:</span>
                      <span className="font-mono font-bold text-emerald-300">
                        {confirmSummary?.officialSubmissionCount ?? 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Test Runs Recorded:</span>
                      <span className="font-mono text-indigo-300">{confirmSummary?.testSubmissionCount ?? 0}</span>
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-300 leading-relaxed">
                  Existing results for Session #{confirmSummary?.sessionNumber ?? sessionNumber} will be{" "}
                  <strong>archived permanently</strong> in <span className="font-mono text-purple-300">championship_finale_archives</span> before rotating to a clean zero-standings draft. Historical Season 1 Daily Pulse and Roster records are never deleted. This rotation cannot be casually undone.
                </p>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={confirmAckChecked}
                    onChange={(e) => setConfirmAckChecked(e.target.checked)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span>
                    I understand existing session standings will be archived and a fresh draft session will open with zero active scores.
                  </span>
                </label>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={confirmAction !== "go_live" && confirmAction !== "end" && (!confirmAckChecked || confirmLoading)}
                onClick={handleConfirmAction}
                className={`flex-1 py-3 rounded-xl text-white font-black text-xs uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                  confirmAction === "go_live"
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30"
                    : confirmAction === "end" || confirmAction === "reset_current_session"
                    ? "bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/30"
                    : "bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-600/30"
                }`}
              >
                <Check className="w-4 h-4" />
                <span>
                  {confirmAction === "go_live"
                    ? "Yes, Go Live Now"
                    : confirmAction === "end"
                    ? "Yes, End Finale"
                    : "Confirm Archive & Reset"}
                </span>
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
