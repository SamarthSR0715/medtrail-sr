import { useState, useEffect, useCallback } from "react";
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
  ChevronRight,
  ChevronLeft,
  FileEdit,
  Eye,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  createEmptyPulseQuestions,
  fetchPulseSetForDate,
  savePulseDraft,
  publishTodayPulse,
  DEFAULT_PULSE_SUBJECTS,
  DEFAULT_DIFFICULTIES,
  type PulseQuestionInput,
  type PulseSubject,
  type PulseDifficulty,
  type PulseCorrectAnswer,
  type PulseSetRecord,
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

  // Load existing pulse set for the selected date
  const loadPulseSet = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const record = await fetchPulseSetForDate(date);
      if (record && record.questions && record.questions.length > 0) {
        // Pad to 5 questions if fewer
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

  useEffect(() => {
    loadPulseSet(pulseDate);
  }, [pulseDate, loadPulseSet]);

  const currentQ = questions[activeSlot - 1] || questions[0]!;

  const handleUpdateCurrentQuestion = (fields: Partial<PulseQuestionInput>) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === activeSlot - 1 ? { ...q, ...fields } : q))
    );
  };

  // Save Draft
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

  // Publish Today's Pulse
  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const res = await publishTodayPulse(pulseDate, questions);
      if (res.success) {
        setStatus("published");
        setPublishedAt(new Date().toISOString());
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

  // Populate sample high-yield MBBS questions (helper for admin drafting)
  const handlePopulateSampleSet = () => {
    if (status === "published" && !confirm("This pulse is currently published. Overwrite with sample questions?")) {
      return;
    }

    const sampleSet: PulseQuestionInput[] = [
      {
        slot: 1,
        subject: "Anatomy",
        difficulty: "Medium",
        xp_value: 50,
        question: "A 24-year-old cyclist falls on his outstretched hand and presents with wrist drop. Which nerve is most likely injured?",
        option_a: "Median nerve",
        option_b: "Radial nerve",
        option_c: "Ulnar nerve",
        option_d: "Axillary nerve",
        correct_answer: "B",
        explanation: "Radial nerve innervates the extensor muscles of the forearm. Injury to the radial nerve (commonly along the spiral groove of the humerus) leads to wrist drop and loss of finger extension.",
      },
      {
        slot: 2,
        subject: "Physiology",
        difficulty: "Medium",
        xp_value: 50,
        question: "Which of the following lung volumes or capacities cannot be measured directly by standard spirometry?",
        option_a: "Vital Capacity (VC)",
        option_b: "Tidal Volume (TV)",
        option_c: "Residual Volume (RV)",
        option_d: "Inspiratory Reserve Volume (IRV)",
        correct_answer: "C",
        explanation: "Residual Volume (RV) cannot be exhaled voluntarily and therefore cannot be measured directly by spirometry; it requires helium dilution or plethysmography.",
      },
      {
        slot: 3,
        subject: "Biochemistry",
        difficulty: "Hard",
        xp_value: 60,
        question: "Which rate-limiting enzyme in glycolysis is allosterically inhibited by high levels of ATP and citrate?",
        option_a: "Hexokinase",
        option_b: "Phosphofructokinase-1 (PFK-1)",
        option_c: "Pyruvate kinase",
        option_d: "Aldolase B",
        correct_answer: "B",
        explanation: "Phosphofructokinase-1 (PFK-1) catalyzes the committed step of glycolysis and is strongly inhibited by high energy state (ATP) and citrate, while being stimulated by AMP and fructose-2,6-bisphosphate.",
      },
      {
        slot: 4,
        subject: "Pharmacology",
        difficulty: "Medium",
        xp_value: 50,
        question: "A patient on heparin therapy develops sudden bleeding. Which antidote is the specific reversal agent for unfractionated heparin?",
        option_a: "Protamine sulfate",
        option_b: "Vitamin K1 (Phytonadione)",
        option_c: "Idarucizumab",
        option_d: "Deferoxamine",
        correct_answer: "A",
        explanation: "Protamine sulfate is a strongly basic peptide that combines with strongly acidic heparin to form a stable, inactive salt complex, reversing its anticoagulant activity.",
      },
      {
        slot: 5,
        subject: "General",
        difficulty: "Easy",
        xp_value: 40,
        question: "Which landmark hill fort in Pune district served as the first capital of the Maratha Empire under Chhatrapati Shivaji Maharaj for over 25 years?",
        option_a: "Sinhagad Fort",
        option_b: "Rajgad Fort",
        option_c: "Torna Fort",
        option_d: "Raigad Fort",
        correct_answer: "B",
        explanation: "Rajgad Fort ('King of Forts') in Pune district was the royal sovereign capital of the Maratha Empire under Chhatrapati Shivaji Maharaj from 1646 to 1672 before the capital shifted to Raigad.",
      },
    ];

    setQuestions(sampleSet);
    toast.success("Loaded 5 high-yield faculty pulse questions into editor.");
  };

  // Helper to check if question is filled
  const isQuestionFilled = (q: PulseQuestionInput) => {
    return (
      q.question.trim().length > 5 &&
      q.option_a.trim().length > 0 &&
      q.option_b.trim().length > 0 &&
      q.option_c.trim().length > 0 &&
      q.option_d.trim().length > 0 &&
      q.explanation.trim().length > 5
    );
  };

  const totalFilled = questions.filter(isQuestionFilled).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── Header Banner ──────────────────────────────────────────────────────── */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                Pulse Studio — Admin Control
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-mono">
                <Lock className="w-3 h-3 text-emerald-400" />
                Faculty Only
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Create Today's Daily Pulse (5 Questions)
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Curate exactly 5 questions for participants. All student pulse questions originate
              strictly from this admin studio and unlock daily at 7:00 PM IST.
            </p>
          </div>

          {/* Date Selector & Status Badge */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200">
              <Calendar className="w-4 h-4 text-blue-400" />
              <input
                type="date"
                value={pulseDate}
                onChange={(e) => setPulseDate(e.target.value)}
                className="bg-transparent text-white font-mono focus:outline-none cursor-pointer"
              />
            </div>

            <div>
              {status === "published" ? (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Published (Live at 7 PM IST)
                </div>
              ) : status === "draft" ? (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wider">
                  <FileEdit className="w-3.5 h-3.5 text-amber-400" />
                  Saved Draft
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold">
                  Not Created Yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4 text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Questions Ready:</span>
              <span className={`font-mono font-bold ${totalFilled === 5 ? "text-emerald-400" : "text-amber-400"}`}>
                {totalFilled} / 5
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Total XP:</span>
              <span className="font-mono font-bold text-blue-400">
                {questions.reduce((acc, q) => acc + (Number(q.xp_value) || 0), 0)} XP
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePopulateSampleSet}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition font-semibold text-xs cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              Load Sample MBBS Set
            </button>
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition font-semibold text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5 text-blue-400" />
              {previewMode ? "Edit Mode" : "Preview Student View"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Question Slot Navigation (1 through 5) ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {[1, 2, 3, 4, 5].map((slot) => {
          const q = questions[slot - 1]!;
          const isFilled = isQuestionFilled(q);
          const isActive = activeSlot === slot;

          return (
            <button
              key={slot}
              onClick={() => setActiveSlot(slot)}
              className={`flex-1 min-w-[130px] p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                isActive
                  ? "bg-blue-600/20 border-blue-500 text-white shadow-lg shadow-blue-500/10 ring-1 ring-blue-500"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Slot #{slot}
                </div>
                <div className="font-bold text-xs sm:text-sm text-slate-100 flex items-center gap-1.5">
                  Question {slot}
                  {slot === 5 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-normal">
                      General
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate max-w-[100px]">
                  {q.subject}
                </div>
              </div>

              {isFilled ? (
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center text-[10px] font-mono">
                  •
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Preview Mode ───────────────────────────────────────────────────────── */}
      {previewMode ? (
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono text-amber-400 uppercase tracking-widest">Student View Preview</span>
              <h3 className="text-xl font-bold text-white">Today's Pulse Set (5 Questions)</h3>
            </div>
            <button
              onClick={() => setPreviewMode(false)}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
            >
              Back to Editor
            </button>
          </div>

          <div className="space-y-6">
            {questions.map((q, idx) => (
              <div key={idx} className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-300 text-xs font-semibold">
                    Question {idx + 1} of 5 · {q.subject}
                  </span>
                  <span className="text-xs font-mono text-emerald-400 font-bold">
                    +{q.xp_value} XP
                  </span>
                </div>

                <p className="text-sm sm:text-base font-semibold text-white">
                  {q.question || <span className="text-slate-600 italic">No question text provided yet.</span>}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(["A", "B", "C", "D"] as const).map((optKey) => {
                    const optText = q[`option_${optKey.toLowerCase()}` as "option_a"];
                    const isCorrect = q.correct_answer === optKey;

                    return (
                      <div
                        key={optKey}
                        className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                          isCorrect
                            ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                            : "bg-slate-900/60 border-slate-800 text-slate-300"
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] ${
                          isCorrect ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"
                        }`}>
                          {optKey}
                        </span>
                        <span>{optText || <span className="text-slate-600 italic">Empty</span>}</span>
                        {isCorrect && (
                          <span className="ml-auto text-[10px] text-emerald-400 font-bold">✓ Correct</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 text-xs text-slate-300 space-y-1">
                    <span className="font-semibold text-blue-400">Explanation for students:</span>
                    <p className="text-slate-300">{q.explanation}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Editor Form for Current Question ───────────────────────────────── */
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800/90 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-widest">
                Editing Question {activeSlot} of 5
              </span>
              <h2 className="text-xl font-black text-white">Question Details</h2>
            </div>

            {/* Subject, Difficulty & XP selectors */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Subject */}
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-mono text-slate-400 uppercase">Subject:</label>
                <select
                  value={currentQ.subject}
                  onChange={(e) => handleUpdateCurrentQuestion({ subject: e.target.value as PulseSubject })}
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-blue-500 focus:outline-none"
                >
                  {DEFAULT_PULSE_SUBJECTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Difficulty */}
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-mono text-slate-400 uppercase">Difficulty:</label>
                <select
                  value={currentQ.difficulty}
                  onChange={(e) => handleUpdateCurrentQuestion({ difficulty: e.target.value as PulseDifficulty })}
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-blue-500 focus:outline-none"
                >
                  {DEFAULT_DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* XP Value */}
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-mono text-slate-400 uppercase">XP:</label>
                <input
                  type="number"
                  min={10}
                  max={200}
                  step={5}
                  value={currentQ.xp_value}
                  onChange={(e) => handleUpdateCurrentQuestion({ xp_value: Number(e.target.value) || 50 })}
                  className="w-20 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs text-center font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Question Text */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-400" />
              Question Statement *
            </label>
            <textarea
              rows={3}
              value={currentQ.question}
              onChange={(e) => handleUpdateCurrentQuestion({ question: e.target.value })}
              placeholder="e.g. A 24-year-old cyclist falls on his outstretched hand and presents with wrist drop. Which nerve is most likely injured?"
              className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition leading-relaxed"
            />
          </div>

          {/* Options A, B, C, D & Correct Answer Selection */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                Options (A, B, C, D) & Select Correct Answer *
              </span>
              <span className="text-[10px] text-slate-400">
                Click the radio button to designate the correct option
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["A", "B", "C", "D"] as const).map((key) => {
                const isCorrect = currentQ.correct_answer === key;
                const fieldName = `option_${key.toLowerCase()}` as "option_a" | "option_b" | "option_c" | "option_d";

                return (
                  <div
                    key={key}
                    onClick={() => handleUpdateCurrentQuestion({ correct_answer: key })}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center gap-3 ${
                      isCorrect
                        ? "bg-emerald-500/10 border-emerald-500/50 ring-1 ring-emerald-500/40"
                        : "bg-slate-950 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center">
                      <input
                        type="radio"
                        name={`correct_q_${activeSlot}`}
                        checked={isCorrect}
                        onChange={() => handleUpdateCurrentQuestion({ correct_answer: key })}
                        className="w-4 h-4 text-emerald-500 accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                      isCorrect ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-300"
                    }`}>
                      {key}
                    </span>

                    <input
                      type="text"
                      value={currentQ[fieldName]}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleUpdateCurrentQuestion({ [fieldName]: e.target.value })}
                      placeholder={`Option ${key} text...`}
                      className="flex-1 bg-transparent border-0 text-white text-xs sm:text-sm focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Explanation */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              Faculty Explanation (Visible to students after submitting attempt) *
            </label>
            <textarea
              rows={3}
              value={currentQ.explanation}
              onChange={(e) => handleUpdateCurrentQuestion({ explanation: e.target.value })}
              placeholder="e.g. Radial nerve innervates extensor muscles of forearm. Injury along the spiral groove leads to wrist drop and inability to extend the wrist and MCP joints."
              className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white text-sm focus:border-blue-500 focus:outline-none transition leading-relaxed"
            />
          </div>

          {/* Navigation between questions */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-800 text-xs">
            <button
              disabled={activeSlot === 1}
              onClick={() => setActiveSlot((s) => Math.max(1, s - 1))}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous Question
            </button>

            <span className="font-mono text-slate-400 text-xs">
              Question {activeSlot} of 5
            </span>

            <button
              disabled={activeSlot === 5}
              onClick={() => setActiveSlot((s) => Math.min(5, s + 1))}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition flex items-center gap-1 cursor-pointer"
            >
              Next Question <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Publishing Action Bar ────────────────────────────────────────────── */}
      {/* Required by user prompt: Add two buttons: Save Draft, Publish Today's Pulse */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <div className="text-xs text-slate-300 font-semibold flex items-center gap-2 justify-center sm:justify-start">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>Automatic Availability: 7:00 PM IST</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Only one Pulse set can be published per day. When published, it becomes active to all medical students at 7:00 PM IST.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Button 1: Save Draft */}
          <button
            onClick={handleSaveDraft}
            disabled={isSaving || isPublishing}
            className="flex-1 sm:flex-none px-6 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer border border-slate-700 shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-blue-400" />
            {isSaving ? "Saving..." : "Save Draft"}
          </button>

          {/* Button 2: Publish Today's Pulse */}
          <button
            onClick={handlePublish}
            disabled={isSaving || isPublishing}
            className="flex-1 sm:flex-none px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-emerald-600/30 hover:shadow-emerald-500/50 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4 text-white" />
            {isPublishing ? "Publishing to Supabase..." : "Publish Today's Pulse"}
          </button>
        </div>
      </div>
    </div>
  );
}
