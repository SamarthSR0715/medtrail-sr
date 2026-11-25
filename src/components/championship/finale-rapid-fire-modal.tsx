/**
 * finale-rapid-fire-modal.tsx
 * MedTrail Grand Finale Format B — 90-Second Rapid Fire Exam Modal.
 *
 * FULLY ISOLATED from Daily Pulse UI. Zero shared state with championship.tsx quiz.
 *
 * Phases:
 *   IDLE | LOADING | WAITING_ROOM | TEST_DEVICE_GATE | ACTIVE_EXAM | CONFIRMING | SUBMITTING | RESULTS
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FlaskConical,
  Hourglass,
  Laptop,
  Loader2,
  Lock,
  Medal,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Trophy,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  clearFinaleSessionCache,
  DEFAULT_FINALE_CODE,
  encodeAnswer,
  FINALE_DURATION_SECONDS,
  FINALE_MAX_SCORE,
  FINALE_POINTS_PER_CORRECT,
  FINALE_QUESTION_COUNT,
  getOrCreateFinaleDeviceId,
  getPublicFinaleStatus,
  letterToIndex,
  loadFinaleSessionCache,
  requestFinaleTestDevice,
  saveFinaleSessionCache,
  startFinaleSession,
  submitFinaleAttempt,
  subscribeToFinalePublicState,
  type FinaleExplanation,
  type FinaleQuestion,
} from '@/lib/finale-service';

type ExamPhase =
  | 'IDLE'
  | 'LOADING'
  | 'WAITING_ROOM'
  | 'TEST_DEVICE_GATE'
  | 'ACTIVE_EXAM'
  | 'CONFIRMING'
  | 'SUBMITTING'
  | 'RESULTS';

interface SubmitResult {
  isTest: boolean;
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
  onCompleted?: () => void;
}

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

export function FinaleRapidFireModal({ isOpen, onClose, finaleCode, onCompleted }: Props) {
  const code = finaleCode || DEFAULT_FINALE_CODE;
  const deviceId = getOrCreateFinaleDeviceId();

  const [phase, setPhase] = useState<ExamPhase>('IDLE');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [questions, setQuestions] = useState<FinaleQuestion[]>([]);
  const [seatNumber, setSeatNumber] = useState<number>(0);
  const [studentName, setStudentName] = useState<string>('');
  const [isTestSession, setIsTestSession] = useState<boolean>(false);

  const [answers, setAnswers] = useState<number[]>(Array(FINALE_QUESTION_COUNT).fill(-1));
  const [currentSlot, setCurrentSlot] = useState<number>(0);

  const [timeLeft, setTimeLeft] = useState<number>(FINALE_DURATION_SECONDS);
  const rafRef = useRef<number | null>(null);

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [expandedExpl, setExpandedExpl] = useState<number | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExpiredTestRun, setIsExpiredTestRun] = useState<boolean>(false);
  const [devicePending, setDevicePending] = useState<boolean>(false);
  const [registeringDevice, setRegisteringDevice] = useState<boolean>(false);
  const [deviceLabelInput, setDeviceLabelInput] = useState<string>('');

  const submitOnceRef = useRef<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  const answersRef = useRef<number[]>(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const handleClose = useCallback(() => {
    if (phase === 'ACTIVE_EXAM' || phase === 'CONFIRMING') {
      toast.warning('The exam is active. Click "Submit All" to finish or wait for auto-submit.');
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
    setIsTestSession(false);
    setIsExpiredTestRun(false);
    setDevicePending(false);
    submitOnceRef.current = false;
    isSubmittingRef.current = false;
    onClose();
  }, [phase, onClose]);

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
        isTest: isTestSession,
        questions,
        answers: newAnswers,
        currentSlot: newSlot,
      });
    },
    [sessionId, expiresAt, questions, seatNumber, studentName, isTestSession, code]
  );

  const doSubmit = useCallback(async (finalAnswers: number[]) => {
    if (submitOnceRef.current || isSubmittingRef.current) return;
    if (!sessionIdRef.current) return;

    submitOnceRef.current = true;
    isSubmittingRef.current = true;
    setPhase('SUBMITTING');

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const safeAnswers = Array.from({ length: FINALE_QUESTION_COUNT }, (_, i) => {
      const a = finalAnswers[i] ?? -1;
      return a >= -1 && a <= 3 ? a : -1;
    });

    try {
      const res = await submitFinaleAttempt({
        sessionId: sessionIdRef.current,
        answers: safeAnswers,
      });

      clearFinaleSessionCache();

      if (!res.success) {
        if (res.alreadySubmitted) {
          toast.info('Submission already recorded.');
          setErrorMsg('Your submission has already been recorded. Only 1 official attempt is permitted.');
          setPhase('IDLE');
          onCompletedRef.current?.();
          return;
        }
        if (res.eventEnded) {
          setErrorMsg('The Grand Finale has been ended by the administrator. Late submissions are rejected.');
          setPhase('IDLE');
          onCompletedRef.current?.();
          return;
        }
        if (res.deadlineExceeded) {
          setErrorMsg('The 90-second server deadline expired before your answers arrived.');
          setPhase('IDLE');
          return;
        }
        if (res.deviceMismatch) {
          setErrorMsg('Device mismatch: submission must come from the same device that started the session.');
          setPhase('IDLE');
          return;
        }
        setErrorMsg(res.error || 'Submission failed. Please contact the administrator.');
        setPhase('IDLE');
        return;
      }

      setResult({
        isTest: res.isTest,
        score: res.score,
        accuracy: res.accuracy,
        correctCount: res.correctCount,
        elapsedSeconds: res.elapsedSeconds,
        explanations: res.explanations,
      });
      setPhase('RESULTS');
      if (!res.isTest) {
        onCompletedRef.current?.();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error during submission.');
      setPhase('IDLE');
    } finally {
      isSubmittingRef.current = false;
    }
  }, []);

  const startTimer = useCallback(
    (expMs: number) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

      const tick = () => {
        const remaining = (expMs - Date.now()) / 1000;
        if (remaining <= 0) {
          setTimeLeft(0);
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

  // Always verify session state against server; merge local answers ONLY if same active sessionId
  const handleOpen = useCallback(async () => {
    setErrorMsg(null);
    setIsExpiredTestRun(false);
    setDevicePending(false);
    submitOnceRef.current = false;
    isSubmittingRef.current = false;
    setPhase('LOADING');

    const res = await startFinaleSession(code);

    if (!res.success) {
      if (res.waitingRoom) {
        setSeatNumber(res.seatNumber ?? 0);
        setStudentName(res.studentName || '');
        setErrorMsg(res.error || 'Questions are published. Waiting for the administrator to click Go Live Finale.');
        setPhase('WAITING_ROOM');
        return;
      }
      if (res.testDeviceUnauthorized) {
        setIsTestSession(true);
        setDevicePending(Boolean(res.devicePending));
        setErrorMsg(res.error || 'Authorize this device before starting Classic crew test runs.');
        setPhase('TEST_DEVICE_GATE');
        return;
      }

      setPhase('IDLE');
      setIsTestSession(Boolean(res.isTest));
      if (res.notFinalist) {
        setErrorMsg('Access restricted. Only the 10 approved Grand Finale finalists may participate.');
        return;
      }
      if (res.alreadySubmitted) {
        setErrorMsg('You have already submitted your official Grand Finale attempt. Only 1 attempt is permitted.');
        onCompletedRef.current?.();
        return;
      }
      if (res.eventEnded) {
        clearFinaleSessionCache();
        setErrorMsg('The Grand Finale has ended and submissions are closed.');
        onCompletedRef.current?.();
        return;
      }
      if (res.deviceMismatch) {
        setErrorMsg('Device mismatch detected: resume from the same browser/device that opened your session.');
        return;
      }
      if (res.sessionExpired) {
        clearFinaleSessionCache();
        setIsExpiredTestRun(Boolean(res.isTest));
        setErrorMsg(
          res.isTest
            ? 'Previous 90-second test window expired. You can start a fresh isolated test run below.'
            : 'Your 90-second examination window has expired. The session cannot be resumed.'
        );
        return;
      }
      setErrorMsg(res.error || 'Could not start session. Please try again.');
      return;
    }

    const expMs = new Date(res.expiresAt).getTime();
    const cached = loadFinaleSessionCache();
    const restoredAnswers =
      cached &&
      cached.sessionId === res.sessionId &&
      cached.finaleCode === code &&
      Array.isArray(cached.answers) &&
      cached.answers.length === FINALE_QUESTION_COUNT
        ? cached.answers
        : (Array(FINALE_QUESTION_COUNT).fill(-1) as number[]);
    const restoredSlot =
      cached && cached.sessionId === res.sessionId && typeof cached.currentSlot === 'number'
        ? Math.max(0, Math.min(FINALE_QUESTION_COUNT - 1, cached.currentSlot))
        : 0;

    setSessionId(res.sessionId);
    setExpiresAt(expMs);
    setQuestions(res.questions);
    setAnswers(restoredAnswers);
    setCurrentSlot(restoredSlot);
    setSeatNumber(res.seatNumber);
    setStudentName(res.studentName);
    setIsTestSession(res.isTest);
    setPhase('ACTIVE_EXAM');
    startTimer(expMs);

    saveFinaleSessionCache({
      sessionId: res.sessionId,
      finaleCode: code,
      startedAt: res.startedAt,
      expiresAt: res.expiresAt,
      seatNumber: res.seatNumber,
      studentName: res.studentName,
      isTest: res.isTest,
      questions: res.questions,
      answers: restoredAnswers,
      currentSlot: restoredSlot,
    });

    if (cached && cached.sessionId === res.sessionId) {
      toast.success('Active session synced with server clock.');
    }
  }, [code, startTimer]);

  // Auto-open when modal becomes visible
  useEffect(() => {
    if (isOpen && phase === 'IDLE') {
      handleOpen();
    }
    if (!isOpen && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime auto-transition from WAITING_ROOM -> ACTIVE_EXAM when Admin clicks Go Live,
  // and detect ENDED event during Waiting Room
  useEffect(() => {
    if (!isOpen || phase !== 'WAITING_ROOM') return;
    const unsub = subscribeToFinalePublicState(code, async () => {
      const pub = await getPublicFinaleStatus(code);
      if (pub.status === 'live') {
        toast.success('Grand Finale is now LIVE! Opening examination...');
        handleOpen();
      } else if (pub.status === 'ended' || pub.status === 'closed') {
        setErrorMsg('The Grand Finale has ended.');
        setPhase('IDLE');
      }
    });
    return () => {
      unsub();
    };
  }, [isOpen, phase, code, handleOpen]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

  const goToSlot = useCallback(
    (idx: number) => {
      if (phase !== 'ACTIVE_EXAM') return;
      const target = Math.max(0, Math.min(FINALE_QUESTION_COUNT - 1, idx));
      setCurrentSlot(target);
      persistCache(answersRef.current, target);
    },
    [phase, persistCache]
  );

  const handleRegisterTestDevice = async () => {
    setRegisteringDevice(true);
    try {
      const res = await requestFinaleTestDevice(deviceLabelInput);
      if (!res.success) {
        toast.error(res.error || 'Could not register test device.');
        return;
      }
      if (res.isAuthorized) {
        toast.success('Device already authorized! Starting test run...');
        handleOpen();
      } else {
        setDevicePending(true);
        toast.success('Device registered as PENDING. Approve it in Grand Finale Ops, then click Retry Launch.');
      }
    } finally {
      setRegisteringDevice(false);
    }
  };

  if (!isOpen) return null;

  const answeredCount = answers.filter((a) => a >= 0).length;
  const timerPct = Math.max(0, Math.min(100, (timeLeft / FINALE_DURATION_SECONDS) * 100));
  const currentQ = questions[currentSlot] ?? null;
  const currentAnswer = answers[currentSlot] ?? -1;

  // RENDER: LOADING
  if (phase === 'LOADING') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/30 p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
          <h3 className="text-xl font-black text-white">Connecting to Exam Server…</h3>
          <p className="text-sm text-slate-400">Verifying credentials, device lock, and server timer.</p>
        </div>
      </div>
    );
  }

  // RENDER: WAITING ROOM (Published but not yet Live)
  if (phase === 'WAITING_ROOM') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-blue-500/40 p-8 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center mx-auto">
            <Hourglass className="w-8 h-8 text-blue-400 animate-pulse" />
          </div>
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold uppercase tracking-wider">
              <Lock className="w-3 h-3" />
              Finalist Waiting Room
            </span>
            <h3 className="text-xl font-black text-white">
              {studentName ? `Welcome, ${studentName}` : 'Approved Finalist Verified'}
              {seatNumber > 0 ? ` · Seat #${seatNumber}` : ''}
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {errorMsg || 'The 10 Finale questions are published and locked. Questions unlock automatically when the administrator clicks Go Live Finale.'}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleOpen}
              className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Check Status</span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: CLASSIC CREW TEST DEVICE AUTHORIZATION GATE
  if (phase === 'TEST_DEVICE_GATE') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-indigo-500/40 p-7 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
              <Laptop className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                <FlaskConical className="w-3 h-3" /> Classic crew · Device Verification
              </span>
              <h3 className="text-lg font-black text-white">Authorize This Test Device</h3>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">{errorMsg}</p>

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <div className="text-[10px] font-mono uppercase text-slate-500">Current Browser Device Fingerprint</div>
            <div className="text-xs font-mono text-indigo-300 break-all select-all">{deviceId}</div>
          </div>

          {!devicePending && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Optional Device Label</label>
              <input
                type="text"
                value={deviceLabelInput}
                onChange={(e) => setDeviceLabelInput(e.target.value)}
                placeholder="e.g. Organiser Chrome Testing"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 outline-none"
              />
            </div>
          )}

          <div className="space-y-2.5">
            {!devicePending && (
              <button
                type="button"
                disabled={registeringDevice}
                onClick={handleRegisterTestDevice}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50"
              >
                {registeringDevice ? 'Registering Device…' : 'Register This Device for Admin Approval'}
              </button>
            )}

            <button
              type="button"
              onClick={handleOpen}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Re-Check Approval &amp; Start Test</span>
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: IDLE / ERROR
  if (phase === 'IDLE') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-rose-500/30 p-8 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-rose-400" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white mb-1">Grand Finale</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{errorMsg || 'Session could not be started.'}</p>
          </div>
          <div className="space-y-2.5">
            {isExpiredTestRun && (
              <button
                type="button"
                onClick={handleOpen}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Fresh Test Run</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: SUBMITTING
  if (phase === 'SUBMITTING') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
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

  // RENDER: RESULTS
  if (phase === 'RESULTS' && result !== null) {
    const r = result;
    const scorePercent = (r.score / FINALE_MAX_SCORE) * 100;
    const mins = Math.floor(r.elapsedSeconds / 60);
    const secs = Math.round(r.elapsedSeconds % 60);
    const timeDisplay = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md overflow-y-auto">
        <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-amber-500/40 p-6 sm:p-8 space-y-6 shadow-2xl my-4">
          {r.isTest && (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 text-xs">
              <FlaskConical className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                <strong>ISOLATED TEST MODE (is_test = true)</strong> — Attempt saved for verification only and excluded from official standings and prizes.
              </span>
            </div>
          )}

          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
              <Trophy className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-2xl font-black text-white">
              {r.isTest ? 'Test Run Complete!' : 'Grand Finale Complete!'}
            </h2>
            <p className="text-sm text-slate-400">
              {studentName} · {r.isTest ? 'Isolated Tester' : `Seat #${seatNumber}`}
            </p>
          </div>

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
                <div key={expl.slot} className="rounded-2xl bg-slate-800/50 border border-slate-700/40 overflow-hidden">
                  <button
                    type="button"
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
                    <span
                      className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${
                        isSkipped
                          ? 'bg-slate-700 text-slate-400'
                          : isCorrect
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
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
                          const optText = qItem ? getOptionText(qItem, idx) : `Option ${letter}`;
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

          <div className="flex flex-col sm:flex-row gap-3">
            {r.isTest && (
              <button
                type="button"
                onClick={() => {
                  clearFinaleSessionCache();
                  setResult(null);
                  handleOpen();
                }}
                className="flex-1 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm uppercase tracking-wider transition cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Run Another Test Attempt
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-black text-sm uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-600/30"
            >
              Return to Championship Board
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: CONFIRMING
  if (phase === 'CONFIRMING') {
    const unanswered = FINALE_QUESTION_COUNT - answeredCount;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-amber-500/40 p-7 space-y-5 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7 text-amber-400" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-xl font-black text-white">
              {isTestSession ? 'Submit Test Run' : 'Confirm Final Submission'}
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              You answered <span className="text-white font-bold">{answeredCount}</span> of{' '}
              <span className="text-white font-bold">{FINALE_QUESTION_COUNT}</span> questions.
              {unanswered > 0 && (
                <>
                  {' '}
                  <span className="text-amber-400 font-bold">{unanswered} skipped</span> question
                  {unanswered > 1 ? 's' : ''} will score 0.
                </>
              )}
            </p>
            {!isTestSession && (
              <p className="text-xs text-rose-400 font-semibold pt-1 inline-flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> This action is irreversible. Only 1 official attempt is permitted.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPhase('ACTIVE_EXAM')}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={() => doSubmit(answersRef.current)}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-600/30"
            >
              Submit Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: ACTIVE EXAM
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-950/92 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-indigo-500/30 shadow-2xl flex flex-col max-h-[96vh] overflow-hidden">
        {isTestSession && (
          <div className="px-4 py-2 bg-indigo-600/25 border-b border-indigo-500/40 flex items-center justify-center gap-2 text-[11px] font-bold text-indigo-200 shrink-0">
            <FlaskConical className="w-3.5 h-3.5 text-indigo-400" />
            <span>ISOLATED TEST MODE ({studentName}) · Excluded from Official Standings</span>
          </div>
        )}

        <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-800/60 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Grand Finale</div>
            <div className="text-xs text-slate-300 font-medium truncate">
              {studentName || 'Contestant'} · {isTestSession ? 'Test Seat #0' : `Seat #${seatNumber}`}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Clock className={`w-4 h-4 ${timerColorClass(timeLeft)}`} />
            <span className={`text-xl font-black tabular-nums ${timerColorClass(timeLeft)}`}>
              {formatTime(timeLeft)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="h-1 w-full bg-slate-800 shrink-0">
          <div className={`h-full transition-all ${timerBarClass(timeLeft)}`} style={{ width: `${timerPct}%` }} />
        </div>

        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-800/60 shrink-0 flex-wrap">
          {Array.from({ length: FINALE_QUESTION_COUNT }, (_, i) => {
            const ans = answers[i] ?? -1;
            const isAnswered = ans >= 0;
            const isCurrent = i === currentSlot;
            return (
              <button
                type="button"
                key={i}
                onClick={() => goToSlot(i)}
                className={`w-8 h-8 rounded-xl text-xs font-black transition cursor-pointer ${
                  isCurrent
                    ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-400/50'
                    : isAnswered
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {currentQ ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold">
                  Question {currentSlot + 1} / {FINALE_QUESTION_COUNT}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-bold">
                  {currentQ.subject}
                </span>
                {currentQ.difficulty && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold">
                    {currentQ.difficulty}
                  </span>
                )}
              </div>

              <p className="text-base sm:text-lg font-bold text-white leading-relaxed">{currentQ.question}</p>

              <div className="space-y-2.5">
                {[0, 1, 2, 3].map((idx) => {
                  const letter = optionLabel(idx);
                  const optText = getOptionText(currentQ, idx);
                  const isSelected = currentAnswer === idx;
                  return (
                    <button
                      type="button"
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
                          isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'
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
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">Question not available.</div>
          )}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-slate-800/60 flex items-center gap-3">
          <button
            type="button"
            onClick={() => goToSlot(currentSlot - 1)}
            disabled={currentSlot === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>

          <div className="flex-1 text-center text-xs text-slate-500 font-medium">
            <span className="text-emerald-400 font-bold">{answeredCount}</span>/{FINALE_QUESTION_COUNT} answered
          </div>

          <button
            type="button"
            onClick={() => goToSlot(currentSlot + 1)}
            disabled={currentSlot === FINALE_QUESTION_COUNT - 1}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (phase === 'ACTIVE_EXAM') setPhase('CONFIRMING');
            }}
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
