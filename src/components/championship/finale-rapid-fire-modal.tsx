/**
 * finale-rapid-fire-modal.tsx
 * MedTrail Grand Finale Format B — 90-Second Rapid Fire Exam Modal.
 *
 * FULLY ISOLATED from Daily Pulse UI. Zero shared state with championship.tsx quiz.
 *
 * State machine:
 *   IDLE → LOADING → ACTIVE_EXAM → CONFIRMING → SUBMITTING → RESULTS
 *
 * Key design decisions:
 *   - Timer anchored to server-authoritative expiresAt, not client start time.
 *   - Timer uses requestAnimationFrame loop; never resets on question navigation.
 *   - Answers persisted to sessionStorage on every change for refresh-recovery.
 *   - Auto-submit fires when countdown reaches 0.
 *   - Manual submit requires explicit confirmation dialog.
 *   - Duplicate submission prevention: submitOnceRef + already_submitted guard.
 *   - Score = correctCount * 100 (max 1000, as per Format B rules).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Trophy,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  X,
  Zap,
  BookOpen,
  Medal,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  startFinaleSession,
  submitFinaleAttempt,
  saveFinaleSessionCache,
  loadFinaleSessionCache,
  clearFinaleSessionCache,
  encodeAnswer,
  letterToIndex,
  DEFAULT_FINALE_CODE,
  FINALE_QUESTION_COUNT,
  FINALE_DURATION_SECONDS,
  FINALE_POINTS_PER_CORRECT,
  FINALE_MAX_SCORE,
  type FinaleQuestion,
  type FinaleExplanation,
} from '@/lib/finale-service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ExamPhase =
  | 'IDLE'
  | 'LOADING'
  | 'ACTIVE_EXAM'
  | 'CONFIRMING'
  | 'SUBMITTING'
  | 'RESULTS';

interface SubmitResult {
  score: number;
  accuracy: number;
  correctCount: number;
  elapsedSeconds: number;
  explanations: FinaleExplanation[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  finaleCode?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}:${ss.toString().padStart(2, '0')}` : `${ss}s`;
}

function optionLabel(idx: number): string {
  return ['A', 'B', 'C', 'D'][idx] ?? '?';
}

function getOptionText(q: FinaleQuestion, idx: number): string {
  return [q.option_a, q.option_b, q.option_c, q.option_d][idx] ?? '';
}

function timerColorClass(secs: number): string {
  if (secs <= 10) return 'text-rose-400';
  if (secs <= 25) return 'text-amber-400';
  return 'text-emerald-400';
}

function timerBarClass(secs: number): string {
  if (secs <= 10) return 'bg-rose-500';
  if (secs <= 25) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function FinaleRapidFireModal({ isOpen, onClose, finaleCode }: Props) {
  const code = finaleCode || DEFAULT_FINALE_CODE;

  // Phase state machine
  const [phase, setPhase] = useState<ExamPhase>('IDLE');

  // Session data (from server)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0); // epoch ms
  const [questions, setQuestions] = useState<FinaleQuestion[]>([]);
  const [seatNumber, setSeatNumber] = useState<number>(0);
  const [studentName, setStudentName] = useState<string>('');

  // Answer state: 10-slot array, each in {-1,0,1,2,3}. -1 = not answered.
  const [answers, setAnswers] = useState<number[]>(Array(FINALE_QUESTION_COUNT).fill(-1));
  const [currentSlot, setCurrentSlot] = useState<number>(0); // 0-based

  // Timer
  const [timeLeft, setTimeLeft] = useState<number>(FINALE_DURATION_SECONDS);
  const rafRef = useRef<number | null>(null);

  // Results
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [expandedExpl, setExpandedExpl] = useState<number | null>(null);

  // Error display
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Submission guard — prevent duplicate submit calls
  const submitOnceRef = useRef<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  // Answers ref for auto-submit (avoids stale closure)
  const answersRef = useRef<number[]>(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // ── Reset when modal is closed ───────────────────────────────────────────────
  const handleClose = useCallback(() => {
    // If exam is active, don't allow accidental close (session remains server-side)
    if (phase === 'ACTIVE_EXAM' || phase === 'CONFIRMING') {
      toast.warning('The exam is running. Use "Submit All" to finish, or wait for auto-submit.');
      return;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPhase('IDLE');
    setSessionId(null);
    setExpiresAt(0);
    setQuestions([]);
    setAnswers(Array(FINALE_QUESTION_COUNT).fill(-1));
    setCurrentSlot(0);
    setTimeLeft(FINALE_DURATION_SECONDS);
    setResult(null);
    setExpandedExpl(null);
    setErrorMsg(null);
    submitOnceRef.current = false;
    isSubmittingRef.current = false;
    onClose();
  }, [phase, onClose]);

  // ── Persist answers to sessionStorage on every change ────────────────────────
  const persistCache = useCallback(
    (newAnswers: number[], newSlot: number) => {
      if (!sessionId || expiresAt === 0 || questions.length === 0) return;
      saveFinaleSessionCache({
        sessionId,
        finaleCode: code,
        startedAt: new Date(expiresAt - FINALE_DURATION_SECONDS * 1000).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        seatNumber,
        studentName,
        questions,
        answers: newAnswers,
        currentSlot: newSlot,
      });
    },
    [sessionId, expiresAt, questions, seatNumber, studentName, code]
  );

  // ── Core submit (used by both auto and manual) ────────────────────────────────
  const doSubmit = useCallback(
    async (finalAnswers: number[]) => {
      if (submitOnceRef.current || isSubmittingRef.current) return;
      if (!sessionIdRef.current) return;

      submitOnceRef.current = true;
      isSubmittingRef.current = true;
      setPhase('SUBMITTING');

      // Stop timer
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      // Ensure exactly 10 answers (replace any stale nulls with -1)
      const safeAnswers = Array.from({ length: FINALE_QUESTION_COUNT }, (_, i) => {
        const a = finalAnswers[i] ?? -1;
        return a >= -1 && a <= 3 ? a : -1;
      });

      try {
        const res = await submitFinaleAttempt({
          sessionId: sessionIdRef.current!,
          answers: safeAnswers,
        });

        clearFinaleSessionCache();

        if (!res.success) {
          if (res.alreadySubmitted) {
            toast.info('Your submission was already recorded.');
            setErrorMsg('Your answers have already been submitted. Only 1 attempt is permitted.');
            setPhase('IDLE');
            return;
          }
          if (res.deadlineExceeded) {
            setErrorMsg('The 90-second deadline has passed. Your answers were not accepted.');
            setPhase('IDLE');
            return;
          }
          setErrorMsg(res.error || 'Submission failed. Please contact the administrator.');
          setPhase('IDLE');
          return;
        }

        setResult({
          score: res.score,
          accuracy: res.accuracy,
          correctCount: res.correctCount,
          elapsedSeconds: res.elapsedSeconds,
          explanations: res.explanations,
        });
        setPhase('RESULTS');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Network error during submission.';
        setErrorMsg(msg);
        setPhase('IDLE');
      } finally {
        isSubmittingRef.current = false;
      }
    },
    [] // stable — reads from refs
  );

  // ── RAF timer loop ────────────────────────────────────────────────────────────
  const startTimer = useCallback(
    (expMs: number) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

      const tick = () => {
        const remaining = (expMs - Date.now()) / 1000;
        if (remaining <= 0) {
          setTimeLeft(0);
          // Auto-submit with current answers
          doSubmit(answersRef.current);
          return;
        }
        setTimeLeft(remaining);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [doSubmit]
  );

  // ── Open: try to restore from cache, then start fresh ────────────────────────
  const handleOpen = useCallback(async () => {
    setErrorMsg(null);
    submitOnceRef.current = false;
    isSubmittingRef.current = false;

    // Attempt refresh-recovery from sessionStorage
    const cached = loadFinaleSessionCache();
    if (cached && cached.finaleCode === code) {
      const expMs = new Date(cached.expiresAt).getTime();
      setSessionId(cached.sessionId);
      setExpiresAt(expMs);
      setQuestions(cached.questions);
      setAnswers(cached.answers);
      setCurrentSlot(cached.currentSlot);
      setSeatNumber(cached.seatNumber);
      setStudentName(cached.studentName);
      setPhase('ACTIVE_EXAM');
      startTimer(expMs);
      toast.success('Session restored. Your timer is continuing from where you left off.');
      return;
    }

    // No valid cache — start fresh from server
    setPhase('LOADING');
    const res = await startFinaleSession(code);

    if (!res.success) {
      setPhase('IDLE');
      if (res.notFinalist) {
        setErrorMsg(
          'Access restricted. Only the 10 approved Grand Finale contestants may participate.'
        );
        return;
      }
      if (res.alreadySubmitted) {
        setErrorMsg('You have already completed the Grand Finale. Only 1 attempt is permitted.');
        return;
      }
      if (res.sessionExpired) {
        setErrorMsg('Your 90-second examination window has expired. The session cannot be resumed.');
        clearFinaleSessionCache();
        return;
      }
      setErrorMsg(res.error || 'Could not start session. Please try again.');
      return;
    }

    const expMs = new Date(res.expiresAt).getTime();
    const initAnswers = Array(FINALE_QUESTION_COUNT).fill(-1) as number[];

    setSessionId(res.sessionId);
    setExpiresAt(expMs);
    setQuestions(res.questions);
    setAnswers(initAnswers);
    setCurrentSlot(0);
    setSeatNumber(res.seatNumber);
    setStudentName(res.studentName);
    setPhase('ACTIVE_EXAM');
    startTimer(expMs);

    // Persist immediately
    saveFinaleSessionCache({
      sessionId: res.sessionId,
      finaleCode: code,
      startedAt: res.startedAt,
      expiresAt: res.expiresAt,
      seatNumber: res.seatNumber,
      studentName: res.studentName,
      questions: res.questions,
      answers: initAnswers,
      currentSlot: 0,
    });
  }, [code, startTimer]);

  // Auto-open when modal becomes visible
  useEffect(() => {
    if (isOpen && phase === 'IDLE') {
      handleOpen();
    }
    // Clean up RAF when closed externally
    if (!isOpen && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ── Answer selection ──────────────────────────────────────────────────────────
  const handleSelectAnswer = useCallback(
    (optionIdx: number) => {
      if (phase !== 'ACTIVE_EXAM') return;
      setAnswers((prev) => {
        const next = [...prev];
        next[currentSlot] = encodeAnswer(optionIdx);
        persistCache(next, currentSlot);
        return next;
      });
    },
    [phase, currentSlot, persistCache]
  );

  // ── Question navigation ───────────────────────────────────────────────────────
  const goToSlot = useCallback(
    (idx: number) => {
      if (phase !== 'ACTIVE_EXAM') return;
      const target = Math.max(0, Math.min(FINALE_QUESTION_COUNT - 1, idx));
      setCurrentSlot(target);
      persistCache(answersRef.current, target);
    },
    [phase, persistCache]
  );

  // ── Manual submit trigger ─────────────────────────────────────────────────────
  const handleManualSubmitRequest = useCallback(() => {
    if (phase !== 'ACTIVE_EXAM') return;
    setPhase('CONFIRMING');
  }, [phase]);

  const handleConfirmSubmit = useCallback(() => {
    doSubmit(answersRef.current);
  }, [doSubmit]);

  const handleCancelConfirm = useCallback(() => {
    if (phase === 'CONFIRMING') setPhase('ACTIVE_EXAM');
  }, [phase]);

  if (!isOpen) return null;

  // ── Computed values ───────────────────────────────────────────────────────────
  const answeredCount = answers.filter((a) => a >= 0).length;
  const timerPct = Math.max(0, Math.min(100, (timeLeft / FINALE_DURATION_SECONDS) * 100));
  const currentQ = questions[currentSlot] ?? null;
  const currentAnswer = answers[currentSlot] ?? -1;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: LOADING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (phase === 'LOADING') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/30 p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
          <h3 className="text-xl font-black text-white">Connecting to Secure Exam Server…</h3>
          <p className="text-sm text-slate-400">Validating your finalist credentials and loading your examination.</p>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: IDLE / ERROR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (phase === 'IDLE') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-rose-500/30 p-8 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-rose-400" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white mb-1">Grand Finale</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              {errorMsg || 'Session could not be started.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: SUBMITTING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (phase === 'SUBMITTING') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-indigo-500/30 p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
          <h3 className="text-xl font-black text-white">Submitting Answers…</h3>
          <p className="text-sm text-slate-400">Server is grading your {answeredCount} answered questions. Please wait.</p>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: RESULTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (phase === 'RESULTS' && result !== null) {
    const r = result;
    const scorePercent = (r.score / FINALE_MAX_SCORE) * 100;
    const mins = Math.floor(r.elapsedSeconds / 60);
    const secs = Math.round(r.elapsedSeconds % 60);
    const timeDisplay = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in overflow-y-auto">
        <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-amber-500/40 p-6 sm:p-8 space-y-6 shadow-2xl my-4">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
              <Trophy className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-2xl font-black text-white">Grand Finale Complete!</h2>
            <p className="text-sm text-slate-400">
              {studentName && `${studentName} · `}Seat #{seatNumber}
            </p>
          </div>

          {/* Score banner */}
          <div className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-5 text-center space-y-1">
            <div className="text-5xl font-black text-white">{r.score}</div>
            <div className="text-sm text-slate-400 font-medium">/ {FINALE_MAX_SCORE} Points</div>
            <div className="mt-2 h-2 w-full rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Correct', value: `${r.correctCount}/10`, icon: CheckCircle2, color: 'text-emerald-400' },
              { label: 'Accuracy', value: `${Number(r.accuracy).toFixed(1)}%`, icon: Zap, color: 'text-blue-400' },
              { label: 'Time Taken', value: timeDisplay, icon: Clock, color: 'text-amber-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-2xl bg-slate-800/60 border border-slate-700/40 p-3 text-center">
                <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
                <div className="text-base font-black text-white">{value}</div>
                <div className="text-[11px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>

          {/* Per-question explanations */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              Question-by-Question Review
            </h3>
            {r.explanations.map((expl) => {
              const isCorrect = expl.userAnswer === letterToIndex(expl.correctAnswer);
              const isSkipped = expl.userAnswer < 0;
              const expanded = expandedExpl === expl.slot;

              return (
                <div
                  key={expl.slot}
                  className="rounded-2xl bg-slate-800/50 border border-slate-700/40 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedExpl(expanded ? null : expl.slot)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-700/30 transition"
                  >
                    <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black bg-slate-700 text-slate-300">
                      {expl.slot}
                    </span>
                    <span className="flex-1 text-sm text-slate-200 truncate">{expl.question}</span>
                    <span className="shrink-0">
                      {isSkipped ? (
                        <SkipForward className="w-4 h-4 text-slate-500" />
                      ) : isCorrect ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                    </span>
                    <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${
                      isSkipped
                        ? 'bg-slate-700 text-slate-400'
                        : isCorrect
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {isSkipped ? 'Skipped' : isCorrect ? `+${FINALE_POINTS_PER_CORRECT}` : '0'}
                    </span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-700/40 pt-3">
                      <p className="text-sm text-slate-300 font-medium">{expl.question}</p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {[0, 1, 2, 3].map((idx) => {
                          const letter = optionLabel(idx);
                          const isUserPick = expl.userAnswer === idx;
                          const isAnswer = letterToIndex(expl.correctAnswer) === idx;
                          const qItem = questions[expl.slot - 1];
                          const optText = qItem
                            ? getOptionText(qItem, idx)
                            : `Option ${letter}`;
                          return (
                            <div
                              key={idx}
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${
                                isAnswer
                                  ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                                  : isUserPick && !isAnswer
                                  ? 'bg-rose-500/20 border border-rose-500/50 text-rose-300'
                                  : 'bg-slate-700/40 text-slate-400'
                              }`}
                            >
                              <span className="w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-xs font-black bg-slate-600 text-slate-200">
                                {letter}
                              </span>
                              <span className="flex-1">{optText}</span>
                              {isAnswer && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                              {isUserPick && !isAnswer && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                      {expl.explanation && (
                        <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/30 px-3 py-2.5">
                          <p className="text-xs text-indigo-300 leading-relaxed">
                            <span className="font-bold">Explanation: </span>
                            {expl.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-black text-sm uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-600/30"
          >
            Return to Championship Board
          </button>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: CONFIRMING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (phase === 'CONFIRMING') {
    const unanswered = FINALE_QUESTION_COUNT - answeredCount;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/40 p-7 space-y-5 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7 text-amber-400" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-xl font-black text-white">Confirm Final Submission</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              You have answered <span className="text-white font-bold">{answeredCount}</span> of{' '}
              <span className="text-white font-bold">{FINALE_QUESTION_COUNT}</span> questions.
              {unanswered > 0 && (
                <>
                  {' '}
                  <span className="text-amber-400 font-bold">{unanswered} skipped</span> question
                  {unanswered > 1 ? 's' : ''} will score 0.
                </>
              )}
            </p>
            <p className="text-xs text-rose-400 font-semibold pt-1">
              ⚠ This action is irreversible. Only 1 attempt is permitted.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCancelConfirm}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Go Back
            </button>
            <button
              onClick={handleConfirmSubmit}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-600/30"
            >
              Submit Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER: ACTIVE EXAM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-950/92 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-indigo-500/30 shadow-2xl flex flex-col max-h-[96vh] overflow-hidden">

        {/* ── TOP BAR: Timer + Progress ─────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-800/60 shrink-0">
          {/* Trophy */}
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Trophy className="w-4.5 h-4.5 text-amber-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Grand Finale</div>
            <div className="text-xs text-slate-300 font-medium truncate">
              {studentName || 'Contestant'} · Seat #{seatNumber}
            </div>
          </div>

          {/* Timer */}
          <div className="flex items-center gap-2 shrink-0">
            <Clock className={`w-4 h-4 ${timerColorClass(timeLeft)}`} />
            <span className={`text-xl font-black tabular-nums ${timerColorClass(timeLeft)}`}>
              {formatTime(timeLeft)}
            </span>
          </div>

          {/* Close (non-blocking: warning on active exam) */}
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timer bar */}
        <div className="h-1 w-full bg-slate-800 shrink-0">
          <div
            className={`h-full transition-all ${timerBarClass(timeLeft)}`}
            style={{ width: `${timerPct}%` }}
          />
        </div>

        {/* ── QUESTION NAVIGATION PALETTE ───────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-800/60 shrink-0 flex-wrap">
          {Array.from({ length: FINALE_QUESTION_COUNT }, (_, i) => {
            const ans = answers[i] ?? -1;
            const isAnswered = ans >= 0;
            const isCurrent = i === currentSlot;
            return (
              <button
                key={i}
                onClick={() => goToSlot(i)}
                className={`w-8 h-8 rounded-lg text-xs font-black transition cursor-pointer ${
                  isCurrent
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-1 ring-offset-slate-900'
                    : isAnswered
                    ? 'bg-emerald-600/80 text-white hover:bg-emerald-500'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
            <span className="w-3 h-3 rounded-sm bg-indigo-600 inline-block" /> Current
            <span className="w-3 h-3 rounded-sm bg-emerald-600 inline-block" /> Answered
            <span className="w-3 h-3 rounded-sm bg-slate-800 inline-block" /> Skipped
          </div>
        </div>

        {/* ── QUESTION BODY ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {currentQ ? (
            <>
              {/* Subject + slot badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {currentQ.subject}
                </span>
                <span className="text-xs text-slate-500">Q{currentSlot + 1} of {FINALE_QUESTION_COUNT}</span>
              </div>

              {/* Question text */}
              <p className="text-base sm:text-lg font-semibold text-white leading-relaxed">
                {currentQ.question}
              </p>

              {/* Options */}
              <div className="space-y-2.5">
                {[0, 1, 2, 3].map((idx) => {
                  const letter = optionLabel(idx);
                  const optText = getOptionText(currentQ, idx);
                  const isSelected = currentAnswer === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectAnswer(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition cursor-pointer text-sm ${
                        isSelected
                          ? 'bg-indigo-600/30 border-indigo-500 text-white'
                          : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:border-indigo-500/60 hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${
                          isSelected
                            ? 'bg-indigo-500 text-white'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {letter}
                      </span>
                      <span className="flex-1">{optText}</span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              Question not available.
            </div>
          )}
        </div>

        {/* ── BOTTOM NAV + SUBMIT ────────────────────────────────────────────── */}
        <div className="shrink-0 px-5 py-4 border-t border-slate-800/60 flex items-center gap-3">
          {/* Prev */}
          <button
            onClick={() => goToSlot(currentSlot - 1)}
            disabled={currentSlot === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>

          {/* Progress badge */}
          <div className="flex-1 text-center text-xs text-slate-500 font-medium">
            <span className="text-emerald-400 font-bold">{answeredCount}</span>/{FINALE_QUESTION_COUNT} answered
          </div>

          {/* Next */}
          <button
            onClick={() => goToSlot(currentSlot + 1)}
            disabled={currentSlot === FINALE_QUESTION_COUNT - 1}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Submit */}
          <button
            onClick={handleManualSubmitRequest}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-600/30"
          >
            <Medal className="w-4 h-4" />
            Submit All
          </button>
        </div>
      </div>
    </div>
  );
}

