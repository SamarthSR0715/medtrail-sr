/**
 * finale-service.ts
 * MedTrail Championship Season 1 Grand Finale (Format B — Reusable Multi-Session)
 *
 * Strictly isolated from Daily Pulse services (pulse-service.ts, pulse-admin-service.ts,
 * championship-service.ts). Automatically targets the server's active is_current session
 * ('CURRENT') while supporting archived session lookups by explicit finale_code.
 */

import { supabase } from '@/integrations/supabase/client';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENT_FINALE_CODE = 'CURRENT';
export const DEFAULT_FINALE_CODE = CURRENT_FINALE_CODE;
export const FINALE_QUESTION_COUNT = 10;
export const FINALE_DURATION_SECONDS = 90;
export const FINALE_POINTS_PER_CORRECT = 100;
export const FINALE_MAX_SCORE = 1000;

export const FINALE_DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type FinaleDifficulty = (typeof FINALE_DIFFICULTIES)[number];

export type FinaleLifecycleStatus =
  | 'draft'
  | 'validated'
  | 'published'
  | 'live'
  | 'ended'
  | 'archived'
  | 'closed';

/** sessionStorage key for local answer persistence during active 90s run */
export const FINALE_SESSION_STORAGE_KEY = 'medtrail_finale_session_v1';

/** localStorage key for device binding & tester device verification */
export const FINALE_DEVICE_ID_STORAGE_KEY = 'medtrail_finale_device_id_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Device Fingerprint Helper
// ─────────────────────────────────────────────────────────────────────────────

export function getOrCreateFinaleDeviceId(): string {
  if (typeof window === 'undefined') return 'server-ssr-device';
  try {
    const existing = window.localStorage.getItem(FINALE_DEVICE_ID_STORAGE_KEY);
    if (existing && existing.trim().length >= 12) {
      return existing.trim();
    }
    const generated =
      typeof window.crypto?.randomUUID === 'function'
        ? `dev_${window.crypto.randomUUID()}`
        : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(FINALE_DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    try {
      const ss = window.sessionStorage.getItem(FINALE_DEVICE_ID_STORAGE_KEY);
      if (ss && ss.trim().length >= 12) return ss.trim();
      const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      window.sessionStorage.setItem(FINALE_DEVICE_ID_STORAGE_KEY, generated);
      return generated;
    } catch {
      return 'dev_ephemeral_browser_client';
    }
  }
}

function getDefaultDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser Device';
  const ua = navigator.userAgent || '';
  if (ua.includes('Android')) return 'Android Browser';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Safari/Browser';
  if (ua.includes('Edg/')) return 'Desktop Edge';
  if (ua.includes('Chrome/')) return 'Desktop Chrome';
  if (ua.includes('Firefox/')) return 'Desktop Firefox';
  return 'Web Browser';
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FinaleQuestion {
  slot: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  subject: string;
  difficulty?: string;
  points?: number;
}

export interface FinaleSessionCache {
  sessionId: string;
  finaleCode: string;
  startedAt: string;
  expiresAt: string;
  seatNumber: number;
  studentName: string;
  isTest: boolean;
  questions: FinaleQuestion[];
  answers: number[];
  currentSlot: number;
}

export interface StartFinaleResult {
  success: true;
  isTest: boolean;
  finaleCode: string;
  sessionNumber: number;
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  durationSeconds: number;
  maxScore: number;
  seatNumber: number;
  studentName: string;
  questions: FinaleQuestion[];
}

export interface FinaleRPCError {
  success: false;
  error?: string;
  isTest?: boolean;
  finaleCode?: string;
  notFinalist?: boolean;
  alreadySubmitted?: boolean;
  sessionExpired?: boolean;
  deadlineExceeded?: boolean;
  waitingRoom?: boolean;
  eventEnded?: boolean;
  eventStatus?: string;
  deviceMismatch?: boolean;
  deviceRequired?: boolean;
  testDeviceUnauthorized?: boolean;
  devicePending?: boolean;
  seatNumber?: number;
  studentName?: string;
}

export type StartFinaleResponse = StartFinaleResult | FinaleRPCError;

export interface FinaleExplanation {
  slot: number;
  question: string;
  userAnswer: number;
  correctAnswer: string;
  explanation: string;
  points?: number;
}

export interface SubmitFinaleResult {
  success: true;
  isTest: boolean;
  finaleCode: string;
  attemptId: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  elapsedSeconds: number;
  explanations: FinaleExplanation[];
}

export type SubmitFinaleResponse = SubmitFinaleResult | FinaleRPCError;

export interface FinaleRosterEntry {
  seatNumber: number;
  studentName: string;
  college: string;
  batch: string;
}

export interface FinaleLeaderboardEntry {
  rank: number;
  seatNumber: number;
  studentName: string;
  college: string;
  batch: string;
  score: number;
  accuracy: number;
  elapsedSeconds: number;
  submittedAt: string;
}

export interface PublicFinaleStatus {
  finaleCode: string;
  sessionNumber: number;
  title: string;
  status: FinaleLifecycleStatus;
  questionCount: number;
  durationSeconds: number;
  questionsFrozen: boolean;
  publishedAt: string | null;
  liveStartedAt: string | null;
  endedAt: string | null;
  archivedAt: string | null;
  archiveCount: number;
  callerIsAdmin: boolean;
  callerIsFinalist: boolean;
  callerSeatNumber: number | null;
  callerStudentName: string | null;
  callerHasSubmitted: boolean;
  callerActiveExpiresAt: string | null;
  callerIsTester: boolean;
  callerTesterName: string | null;
  callerTestPreLiveAllowed: boolean;
  callerTestDeviceRegistered: boolean;
  callerTestDeviceAuthorized: boolean;
}

export interface FinaleQuestionAdminInput {
  slot: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  subject: string;
  difficulty: FinaleDifficulty;
  points: number;
}

export interface FinaleAdminRosterMonitor {
  seatNumber: number;
  studentName: string;
  college: string;
  batch: string;
  isActive: boolean;
  accountLinked: boolean;
  sessionStatus: string | null;
  sessionStartedAt: string | null;
  sessionExpiresAt: string | null;
  deviceBound: boolean;
  attemptScore: number | null;
  attemptAccuracy: number | null;
  attemptElapsedSeconds: number | null;
  attemptSubmittedAt: string | null;
}

export interface FinaleTestDeviceEntry {
  deviceId: string;
  deviceLabel: string | null;
  userAgent: string | null;
  isAuthorized: boolean;
  requestedAt: string;
  authorizedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string;
}

export interface FinaleTestAttemptEntry {
  id: string;
  sessionId: string;
  score: number;
  accuracy: number;
  correctCount: number;
  elapsedSeconds: number;
  isTest: boolean;
  deviceId: string | null;
  submittedAt: string;
}

export interface FinaleArchiveEntry {
  id?: string;
  finaleCode: string;
  sessionNumber: number;
  title: string;
  previousStatus: string;
  participantCount: number;
  submissionCount: number;
  publishedAt: string | null;
  liveStartedAt: string | null;
  endedAt: string | null;
  archivedAt: string;
  archiveReason?: string;
  standings: FinaleLeaderboardEntry[];
  questions?: FinaleQuestionAdminInput[];
}

export interface FinaleSessionSummary {
  success: boolean;
  error?: string;
  finaleCode: string;
  sessionNumber: number;
  title: string;
  status: string;
  officialParticipantCount: number;
  officialSubmissionCount: number;
  testSubmissionCount: number;
  leaderboardCount: number;
}

export interface FinaleAdminOverview {
  success: boolean;
  error?: string;
  finaleCode: string;
  sessionNumber: number;
  set: {
    id: string;
    finaleCode: string;
    sessionNumber: number;
    isCurrent: boolean;
    title: string;
    status: FinaleLifecycleStatus;
    questions: FinaleQuestionAdminInput[];
    questionCount: number;
    durationSeconds: number;
    questionsFrozen: boolean;
    officialSessionCount: number;
    publishedAt: string | null;
    liveStartedAt: string | null;
    endedAt: string | null;
    archivedAt: string | null;
    updatedAt: string;
  } | null;
  roster: FinaleAdminRosterMonitor[];
  leaderboard: FinaleLeaderboardEntry[];
  archives: FinaleArchiveEntry[];
  tester: {
    displayName: string;
    email: string;
    isActive: boolean;
    allowPreLive: boolean;
    devices: FinaleTestDeviceEntry[];
    attempts: FinaleTestAttemptEntry[];
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw RPC shapes
// ─────────────────────────────────────────────────────────────────────────────

interface StartSessionRaw {
  success: boolean;
  error?: string;
  message?: string;
  is_test?: boolean;
  finale_code?: string;
  session_number?: number;
  not_finalist?: boolean;
  already_submitted?: boolean;
  session_expired?: boolean;
  waiting_room?: boolean;
  event_ended?: boolean;
  event_status?: string;
  device_mismatch?: boolean;
  device_required?: boolean;
  test_device_unauthorized?: boolean;
  device_pending?: boolean;
  session_id?: string;
  started_at?: string;
  expires_at?: string;
  duration_seconds?: number;
  max_score?: number;
  seat_number?: number;
  student_name?: string;
  questions?: Array<{
    slot: number;
    question: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    subject?: string;
    difficulty?: string;
    points?: number;
  }>;
}

interface SubmitAttemptRaw {
  success: boolean;
  error?: string;
  message?: string;
  is_test?: boolean;
  finale_code?: string;
  already_submitted?: boolean;
  deadline_exceeded?: boolean;
  event_ended?: boolean;
  device_mismatch?: boolean;
  device_required?: boolean;
  test_device_unauthorized?: boolean;
  attempt_id?: string;
  score?: number;
  max_score?: number;
  accuracy?: number;
  correct_count?: number;
  elapsed_seconds?: number;
  explanations?: Array<{
    slot: number;
    question: string;
    user_answer: number;
    correct_answer: string;
    explanation?: string;
    points?: number;
  }>;
}

interface RosterRowRaw {
  seat_number: number;
  student_name: string;
  college: string;
  batch: string;
}

interface LeaderboardRowRaw {
  rank: number;
  seat_number: number;
  student_name: string;
  college: string;
  batch: string;
  score: number;
  accuracy: number;
  elapsed_seconds: number;
  submitted_at: string;
}

interface PublicStatusRaw {
  finale_code: string;
  session_number?: number;
  title: string;
  status: string;
  question_count: number;
  duration_seconds: number;
  questions_frozen: boolean;
  published_at: string | null;
  live_started_at: string | null;
  ended_at: string | null;
  archived_at?: string | null;
  archive_count?: number;
  caller_is_admin: boolean;
  caller_is_finalist: boolean;
  caller_seat_number: number | null;
  caller_student_name: string | null;
  caller_has_submitted: boolean;
  caller_active_expires_at: string | null;
  caller_is_tester: boolean;
  caller_tester_name: string | null;
  caller_test_pre_live_allowed: boolean;
  caller_test_device_registered: boolean;
  caller_test_device_authorized: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Lifecycle, Realtime & Archives
// ─────────────────────────────────────────────────────────────────────────────

function emptyPublicStatus(finaleCode: string): PublicFinaleStatus {
  return {
    finaleCode,
    sessionNumber: 1,
    title: 'MedTrail Championship Season 1 Grand Finale',
    status: 'draft',
    questionCount: 0,
    durationSeconds: FINALE_DURATION_SECONDS,
    questionsFrozen: false,
    publishedAt: null,
    liveStartedAt: null,
    endedAt: null,
    archivedAt: null,
    archiveCount: 0,
    callerIsAdmin: false,
    callerIsFinalist: false,
    callerSeatNumber: null,
    callerStudentName: null,
    callerHasSubmitted: false,
    callerActiveExpiresAt: null,
    callerIsTester: false,
    callerTesterName: null,
    callerTestPreLiveAllowed: false,
    callerTestDeviceRegistered: false,
    callerTestDeviceAuthorized: false,
  };
}

export async function getPublicFinaleStatus(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<PublicFinaleStatus> {
  const deviceId = getOrCreateFinaleDeviceId();
  try {
    const { data, error } = await (supabase.rpc as any)('get_public_finale_status', {
      p_finale_code: finaleCode,
      p_device_id: deviceId,
    });

    if (error || !data) return emptyPublicStatus(finaleCode);

    const r = data as PublicStatusRaw;
    return {
      finaleCode: r.finale_code || finaleCode,
      sessionNumber: Number(r.session_number || 1),
      title: r.title || 'MedTrail Championship Season 1 Grand Finale',
      status: (r.status as FinaleLifecycleStatus) || 'draft',
      questionCount: Number(r.question_count || 0),
      durationSeconds: Number(r.duration_seconds || FINALE_DURATION_SECONDS),
      questionsFrozen: Boolean(r.questions_frozen),
      publishedAt: r.published_at || null,
      liveStartedAt: r.live_started_at || null,
      endedAt: r.ended_at || null,
      archivedAt: r.archived_at || null,
      archiveCount: Number(r.archive_count || 0),
      callerIsAdmin: Boolean(r.caller_is_admin),
      callerIsFinalist: Boolean(r.caller_is_finalist),
      callerSeatNumber: r.caller_seat_number ?? null,
      callerStudentName: r.caller_student_name ?? null,
      callerHasSubmitted: Boolean(r.caller_has_submitted),
      callerActiveExpiresAt: r.caller_active_expires_at ?? null,
      callerIsTester: Boolean(r.caller_is_tester),
      callerTesterName: r.caller_tester_name ?? null,
      callerTestPreLiveAllowed: Boolean(r.caller_test_pre_live_allowed),
      callerTestDeviceRegistered: Boolean(r.caller_test_device_registered),
      callerTestDeviceAuthorized: Boolean(r.caller_test_device_authorized),
    };
  } catch {
    return emptyPublicStatus(finaleCode);
  }
}

export function subscribeToFinalePublicState(
  finaleCode: string,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`finale_public_state_${finaleCode || 'CURRENT'}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'championship_finale_public_state',
      },
      (payload: any) => {
        if (!finaleCode || finaleCode === CURRENT_FINALE_CODE) {
          onChange();
          return;
        }
        const changedCode = payload?.new?.finale_code || payload?.old?.finale_code;
        if (!changedCode || changedCode === finaleCode) {
          onChange();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function getPublicFinaleArchives(): Promise<FinaleArchiveEntry[]> {
  try {
    const { data, error } = await (supabase.rpc as any)('get_public_finale_archives');
    if (error || !Array.isArray(data)) return [];
    return data.map((a: any) => ({
      finaleCode: String(a.finale_code || ''),
      sessionNumber: Number(a.session_number || 1),
      title: String(a.title || ''),
      previousStatus: String(a.previous_status || 'ended'),
      participantCount: Number(a.participant_count || 0),
      submissionCount: Number(a.submission_count || 0),
      publishedAt: a.published_at || null,
      liveStartedAt: a.live_started_at || null,
      endedAt: a.ended_at || null,
      archivedAt: String(a.archived_at || ''),
      standings: Array.isArray(a.standings)
        ? a.standings.map((lb: any) => ({
            rank: Number(lb.rank),
            seatNumber: Number(lb.seat_number),
            studentName: String(lb.student_name || ''),
            college: String(lb.college || ''),
            batch: String(lb.batch || ''),
            score: Number(lb.score || 0),
            accuracy: Number(lb.accuracy || 0),
            elapsedSeconds: Number(lb.elapsed_seconds || 0),
            submittedAt: String(lb.submitted_at || ''),
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exam Session & Submission RPCs
// ─────────────────────────────────────────────────────────────────────────────

export async function startFinaleSession(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<StartFinaleResponse> {
  const deviceId = getOrCreateFinaleDeviceId();
  try {
    const { data, error } = await (supabase.rpc as any)('start_finale_pulse_session_atomic', {
      p_finale_code: finaleCode,
      p_device_id: deviceId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as StartSessionRaw;

    if (!result.success) {
      const errObj: FinaleRPCError = {
        success: false,
        error: result.error || result.message || 'Failed to start session.',
        isTest: Boolean(result.is_test),
        notFinalist: Boolean(result.not_finalist),
        alreadySubmitted: Boolean(result.already_submitted),
        sessionExpired: Boolean(result.session_expired),
        waitingRoom: Boolean(result.waiting_room),
        eventEnded: Boolean(result.event_ended),
        deviceMismatch: Boolean(result.device_mismatch),
        deviceRequired: Boolean(result.device_required),
        testDeviceUnauthorized: Boolean(result.test_device_unauthorized),
        devicePending: Boolean(result.device_pending),
      };
      if (result.finale_code) errObj.finaleCode = result.finale_code;
      if (result.event_status) errObj.eventStatus = result.event_status;
      if (typeof result.seat_number === 'number') errObj.seatNumber = result.seat_number;
      if (result.student_name) errObj.studentName = result.student_name;
      return errObj;
    }

    const questions: FinaleQuestion[] = (result.questions || []).map((q) => ({
      slot: q.slot,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      subject: q.subject || 'Clinical Medicine',
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(typeof q.points === 'number' ? { points: q.points } : {}),
    }));

    return {
      success: true,
      isTest: Boolean(result.is_test),
      finaleCode: result.finale_code || finaleCode,
      sessionNumber: Number(result.session_number || 1),
      sessionId: result.session_id || '',
      startedAt: result.started_at || '',
      expiresAt: result.expires_at || '',
      durationSeconds: result.duration_seconds || FINALE_DURATION_SECONDS,
      maxScore: Number(result.max_score || FINALE_MAX_SCORE),
      seatNumber: result.seat_number ?? 0,
      studentName: result.student_name || '',
      questions,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

export async function submitFinaleAttempt(params: {
  sessionId: string;
  answers: number[];
}): Promise<SubmitFinaleResponse> {
  const { sessionId, answers } = params;

  if (answers.length !== FINALE_QUESTION_COUNT) {
    return {
      success: false,
      error: `Exactly ${FINALE_QUESTION_COUNT} answers required. Got ${answers.length}.`,
    };
  }

  const deviceId = getOrCreateFinaleDeviceId();

  try {
    const { data, error } = await (supabase.rpc as any)('submit_finale_pulse_attempt_atomic', {
      p_session_id: sessionId,
      p_answers: answers,
      p_device_id: deviceId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as SubmitAttemptRaw;

    if (!result.success) {
      return {
        success: false,
        error: result.error || result.message || 'Submission failed.',
        isTest: Boolean(result.is_test),
        alreadySubmitted: Boolean(result.already_submitted),
        deadlineExceeded: Boolean(result.deadline_exceeded),
        eventEnded: Boolean(result.event_ended),
        deviceMismatch: Boolean(result.device_mismatch),
        deviceRequired: Boolean(result.device_required),
        testDeviceUnauthorized: Boolean(result.test_device_unauthorized),
      };
    }

    const explanations: FinaleExplanation[] = (result.explanations || []).map((e) => ({
      slot: e.slot,
      question: e.question,
      userAnswer: e.user_answer,
      correctAnswer: e.correct_answer,
      explanation: e.explanation || '',
      ...(typeof e.points === 'number' ? { points: e.points } : {}),
    }));

    return {
      success: true,
      isTest: Boolean(result.is_test),
      finaleCode: result.finale_code || '',
      attemptId: result.attempt_id || '',
      score: result.score || 0,
      maxScore: Number(result.max_score || FINALE_MAX_SCORE),
      accuracy: result.accuracy || 0,
      correctCount: result.correct_count || 0,
      elapsedSeconds: result.elapsed_seconds || 0,
      explanations,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Roster & Leaderboard RPCs
// ─────────────────────────────────────────────────────────────────────────────

export async function getPublicFinaleRoster(): Promise<FinaleRosterEntry[]> {
  try {
    const { data, error } = await (supabase.rpc as any)('get_public_finale_roster');
    if (error || !data) return [];
    return (data as RosterRowRaw[]).map((r) => ({
      seatNumber: r.seat_number,
      studentName: r.student_name,
      college: r.college,
      batch: r.batch,
    }));
  } catch {
    return [];
  }
}

export async function getPublicFinaleLeaderboard(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<FinaleLeaderboardEntry[]> {
  try {
    const { data, error } = await (supabase.rpc as any)('get_public_finale_leaderboard', {
      p_finale_code: finaleCode,
    });
    if (error || !data) return [];
    return (data as LeaderboardRowRaw[]).map((r) => ({
      rank: r.rank,
      seatNumber: r.seat_number,
      studentName: r.student_name,
      college: r.college,
      batch: r.batch,
      score: r.score,
      accuracy: Number(r.accuracy),
      elapsedSeconds: Number(r.elapsed_seconds),
      submittedAt: r.submitted_at,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Device Self-Registration (Classic Crew Only)
// ─────────────────────────────────────────────────────────────────────────────

export async function requestFinaleTestDevice(
  deviceLabel?: string
): Promise<{ success: boolean; deviceId?: string; isAuthorized?: boolean; error?: string }> {
  const deviceId = getOrCreateFinaleDeviceId();
  try {
    const { data, error } = await (supabase.rpc as any)('request_finale_test_device', {
      p_device_id: deviceId,
      p_device_label: deviceLabel?.trim() || getDefaultDeviceLabel(),
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });

    if (error) return { success: false, error: error.message };
    const r = data as { success: boolean; device_id?: string; is_authorized?: boolean; error?: string };
    if (!r.success) return { success: false, error: r.error || 'Device registration failed.' };
    return {
      success: true,
      deviceId: r.device_id || deviceId,
      isAuthorized: Boolean(r.is_authorized),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local answer persistence helpers (sessionStorage)
// ─────────────────────────────────────────────────────────────────────────────

export function saveFinaleSessionCache(cache: FinaleSessionCache): void {
  try {
    sessionStorage.setItem(FINALE_SESSION_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // non-fatal
  }
}

export function loadFinaleSessionCache(): FinaleSessionCache | null {
  try {
    const raw = sessionStorage.getItem(FINALE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FinaleSessionCache;
    if (!parsed.sessionId || !parsed.expiresAt || !Array.isArray(parsed.questions)) {
      return null;
    }
    if (Date.now() > new Date(parsed.expiresAt).getTime()) {
      sessionStorage.removeItem(FINALE_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearFinaleSessionCache(): void {
  try {
    sessionStorage.removeItem(FINALE_SESSION_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer & Score helpers
// ─────────────────────────────────────────────────────────────────────────────

export function encodeAnswer(selected: number | null): number {
  if (selected === null || selected < 0 || selected > 3) return -1;
  return selected;
}

export function decodeAnswer(encoded: number): number | null {
  return encoded >= 0 && encoded <= 3 ? encoded : null;
}

export function letterToIndex(letter: string): number {
  const map: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return map[letter.toUpperCase()] ?? -1;
}

export function getTotalFinalePoints(questions: FinaleQuestionAdminInput[]): number {
  return questions.reduce((acc, q) => acc + (Number.isFinite(q.points) && q.points > 0 ? q.points : FINALE_POINTS_PER_CORRECT), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Helpers & Reusable Session Management RPCs
// ─────────────────────────────────────────────────────────────────────────────

export function createEmptyFinaleQuestions(): FinaleQuestionAdminInput[] {
  return Array.from({ length: FINALE_QUESTION_COUNT }, (_, i) => ({
    slot: i + 1,
    question: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_answer: 'A',
    explanation: '',
    subject: 'Clinical Medicine',
    difficulty: 'Medium',
    points: FINALE_POINTS_PER_CORRECT,
  }));
}

export function normalizeAdminQuestions(raw: unknown): FinaleQuestionAdminInput[] {
  const defaults = createEmptyFinaleQuestions();
  if (!Array.isArray(raw)) return defaults;

  return defaults.map((fallback, idx) => {
    const item = raw[idx] as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return fallback;

    const rawAns = String(item['correct_answer'] || 'A').trim().toUpperCase();
    const correctAnswer: 'A' | 'B' | 'C' | 'D' =
      rawAns === 'B' || rawAns === 'C' || rawAns === 'D' ? rawAns : 'A';

    const rawDiff = String(item['difficulty'] || 'Medium').trim().toLowerCase();
    const difficulty: FinaleDifficulty =
      rawDiff === 'easy' ? 'Easy' : rawDiff === 'hard' ? 'Hard' : 'Medium';

    const rawPts = Number(item['points']);
    const points =
      Number.isInteger(rawPts) && rawPts >= 1 && rawPts <= 1000
        ? rawPts
        : FINALE_POINTS_PER_CORRECT;

    return {
      slot: idx + 1,
      question: String(item['question'] ?? ''),
      option_a: String(item['option_a'] ?? ''),
      option_b: String(item['option_b'] ?? ''),
      option_c: String(item['option_c'] ?? ''),
      option_d: String(item['option_d'] ?? ''),
      correct_answer: correctAnswer,
      explanation: String(item['explanation'] ?? ''),
      subject: String(item['subject'] || 'Clinical Medicine'),
      difficulty,
      points,
    };
  });
}

export function validateFinaleQuestionsForPublish(
  questions: FinaleQuestionAdminInput[]
): { valid: boolean; firstInvalidSlot?: number; error?: string } {
  if (!Array.isArray(questions) || questions.length !== FINALE_QUESTION_COUNT) {
    return {
      valid: false,
      firstInvalidSlot: 1,
      error: `Exactly ${FINALE_QUESTION_COUNT} complete questions are required.`,
    };
  }

  for (let i = 0; i < FINALE_QUESTION_COUNT; i++) {
    const q = questions[i];
    const slot = i + 1;
    if (!q || !q.question.trim()) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: question text is required.` };
    }
    if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim()) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: all 4 options (A–D) are required.` };
    }
    if (!['A', 'B', 'C', 'D'].includes(q.correct_answer)) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: select correct answer A, B, C, or D.` };
    }
    if (!q.explanation || !q.explanation.trim()) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: faculty explanation is required.` };
    }
    if (!q.subject || !q.subject.trim()) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: subject is required.` };
    }
    if (!FINALE_DIFFICULTIES.includes(q.difficulty)) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: difficulty must be Easy, Medium, or Hard.` };
    }
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 1000) {
      return { valid: false, firstInvalidSlot: slot, error: `Slot ${slot}: points must be a whole number (1–1000).` };
    }
  }

  return { valid: true };
}

export async function publishFinaleSet(params: {
  finaleCode?: string;
  questions: FinaleQuestionAdminInput[];
  status?: 'draft' | 'validated' | 'published';
  title?: string;
}): Promise<{ success: boolean; error?: string; setId?: string; status?: string; finaleCode?: string }> {
  try {
    const targetStatus = params.status || 'published';
    const sanitizedQuestions = params.questions.slice(0, FINALE_QUESTION_COUNT).map((q, idx) => ({
      slot: idx + 1,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_answer: q.correct_answer || 'A',
      explanation: q.explanation || '',
      subject: q.subject || 'Clinical Medicine',
      difficulty: FINALE_DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'Medium',
      points: Number.isInteger(q.points) && q.points >= 1 && q.points <= 1000 ? q.points : FINALE_POINTS_PER_CORRECT,
    }));

    const { data, error } = await (supabase.rpc as any)('publish_finale_set_atomic', {
      p_finale_code: params.finaleCode || CURRENT_FINALE_CODE,
      p_questions: sanitizedQuestions,
      p_status: targetStatus,
      p_title: params.title || 'MedTrail Championship Season 1 Grand Finale',
    });

    if (error) return { success: false, error: error.message };

    const res = data as { success: boolean; error?: string; set_id?: string; status?: string; finale_code?: string };
    if (!res.success) return { success: false, error: res.error || 'Operation failed' };

    return {
      success: true,
      ...(res.set_id ? { setId: res.set_id } : {}),
      ...(res.status ? { status: res.status } : {}),
      ...(res.finale_code ? { finaleCode: res.finale_code } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function goLiveFinale(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<{ success: boolean; liveStartedAt?: string; finaleCode?: string; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('go_live_finale_atomic', {
      p_finale_code: finaleCode,
    });
    if (error) return { success: false, error: error.message };
    const res = data as { success: boolean; error?: string; live_started_at?: string; finale_code?: string };
    if (!res.success) return { success: false, error: res.error || 'Failed to Go Live Finale.' };
    return {
      success: true,
      ...(res.live_started_at ? { liveStartedAt: res.live_started_at } : {}),
      ...(res.finale_code ? { finaleCode: res.finale_code } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function endFinale(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<{ success: boolean; endedAt?: string; expiredSessions?: number; finaleCode?: string; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('end_finale_atomic', {
      p_finale_code: finaleCode,
    });
    if (error) return { success: false, error: error.message };
    const res = data as {
      success: boolean;
      error?: string;
      ended_at?: string;
      expired_sessions?: number;
      finale_code?: string;
    };
    if (!res.success) return { success: false, error: res.error || 'Failed to End Finale.' };
    return {
      success: true,
      ...(res.ended_at ? { endedAt: res.ended_at } : {}),
      ...(typeof res.expired_sessions === 'number' ? { expiredSessions: res.expired_sessions } : {}),
      ...(res.finale_code ? { finaleCode: res.finale_code } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function unlockFinaleForEdit(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<{ success: boolean; requiresNewSession?: boolean; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_unlock_finale_for_edit_atomic', {
      p_finale_code: finaleCode,
    });
    if (error) return { success: false, error: error.message };
    const r = data as { success: boolean; requires_new_session?: boolean; error?: string };
    if (!r.success) {
      return {
        success: false,
        requiresNewSession: Boolean(r.requires_new_session),
        error: r.error || 'Cannot unlock current session in place.',
      };
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchFinaleSessionSummary(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<FinaleSessionSummary> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_get_finale_session_summary', {
      p_finale_code: finaleCode,
    });
    if (error || !data?.success) {
      return {
        success: false,
        error: error?.message || data?.error || 'Could not load session summary.',
        finaleCode,
        sessionNumber: 1,
        title: 'MedTrail Championship Season 1 Grand Finale',
        status: 'draft',
        officialParticipantCount: 0,
        officialSubmissionCount: 0,
        testSubmissionCount: 0,
        leaderboardCount: 0,
      };
    }
    return {
      success: true,
      finaleCode: String(data.finale_code || finaleCode),
      sessionNumber: Number(data.session_number || 1),
      title: String(data.title || ''),
      status: String(data.status || 'draft'),
      officialParticipantCount: Number(data.official_participant_count || 0),
      officialSubmissionCount: Number(data.official_submission_count || 0),
      testSubmissionCount: Number(data.test_submission_count || 0),
      leaderboardCount: Number(data.leaderboard_count || 0),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      finaleCode,
      sessionNumber: 1,
      title: 'MedTrail Championship Season 1 Grand Finale',
      status: 'draft',
      officialParticipantCount: 0,
      officialSubmissionCount: 0,
      testSubmissionCount: 0,
      leaderboardCount: 0,
    };
  }
}

export async function createNewFinaleSession(params: {
  copyQuestions?: boolean;
  title?: string;
  reason?: string;
}): Promise<{
  success: boolean;
  newFinaleCode?: string;
  sessionNumber?: number;
  archivedFinaleCode?: string | null;
  archivedSubmissions?: number;
  error?: string;
}> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_create_new_finale_session_atomic', {
      p_copy_questions: params.copyQuestions ?? true,
      p_title: params.title?.trim() || null,
      p_reason: params.reason?.trim() || 'Started new Grand Finale session',
    });
    if (error) return { success: false, error: error.message };
    const r = data as {
      success: boolean;
      new_finale_code?: string;
      session_number?: number;
      archived_finale_code?: string | null;
      archived_submissions?: number;
      error?: string;
    };
    if (!r.success) return { success: false, error: r.error || 'Could not create new session.' };
    return {
      success: true,
      ...(r.new_finale_code ? { newFinaleCode: r.new_finale_code } : {}),
      ...(typeof r.session_number === 'number' ? { sessionNumber: r.session_number } : {}),
      archivedFinaleCode: r.archived_finale_code ?? null,
      ...(typeof r.archived_submissions === 'number' ? { archivedSubmissions: r.archived_submissions } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function resetFinaleSession(params: {
  finaleCode?: string;
  clearQuestions?: boolean;
}): Promise<{
  success: boolean;
  mode?: string;
  newFinaleCode?: string;
  sessionNumber?: number;
  affectedParticipants?: number;
  affectedSubmissions?: number;
  archived?: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_reset_finale_session_atomic', {
      p_finale_code: params.finaleCode || CURRENT_FINALE_CODE,
      p_clear_questions: Boolean(params.clearQuestions),
    });
    if (error) return { success: false, error: error.message };
    const r = data as any;
    if (!r?.success) return { success: false, error: r?.error || 'Reset failed.' };
    return {
      success: true,
      ...(r.mode ? { mode: String(r.mode) } : {}),
      ...(r.new_finale_code ? { newFinaleCode: String(r.new_finale_code) } : {}),
      ...(typeof r.session_number === 'number' ? { sessionNumber: r.session_number } : {}),
      ...(typeof r.affected_participants === 'number' ? { affectedParticipants: r.affected_participants } : {}),
      ...(typeof r.affected_submissions === 'number' ? { affectedSubmissions: r.affected_submissions } : {}),
      ...(typeof r.archived === 'boolean' ? { archived: r.archived } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchFinaleAdminOverview(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<FinaleAdminOverview> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_get_finale_overview', {
      p_finale_code: finaleCode,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        finaleCode,
        sessionNumber: 1,
        set: null,
        roster: [],
        leaderboard: [],
        archives: [],
        tester: null,
      };
    }

    const r = data as any;
    if (!r?.success) {
      return {
        success: false,
        error: r?.error || 'Failed to load Finale overview.',
        finaleCode,
        sessionNumber: 1,
        set: null,
        roster: [],
        leaderboard: [],
        archives: [],
        tester: null,
      };
    }

    return {
      success: true,
      finaleCode: r.finale_code || finaleCode,
      sessionNumber: Number(r.session_number || 1),
      set: r.set
        ? {
            id: r.set.id,
            finaleCode: r.set.finale_code || r.finale_code || finaleCode,
            sessionNumber: Number(r.set.session_number || r.session_number || 1),
            isCurrent: Boolean(r.set.is_current ?? true),
            title: r.set.title,
            status: (r.set.status as FinaleLifecycleStatus) || 'draft',
            questions: normalizeAdminQuestions(r.set.questions),
            questionCount: Number(r.set.question_count || 0),
            durationSeconds: Number(r.set.duration_seconds || FINALE_DURATION_SECONDS),
            questionsFrozen: Boolean(r.set.questions_frozen),
            officialSessionCount: Number(r.set.official_session_count || 0),
            publishedAt: r.set.published_at || null,
            liveStartedAt: r.set.live_started_at || null,
            endedAt: r.set.ended_at || null,
            archivedAt: r.set.archived_at || null,
            updatedAt: r.set.updated_at || '',
          }
        : null,
      roster: Array.isArray(r.roster)
        ? r.roster.map((row: any) => ({
            seatNumber: Number(row.seat_number),
            studentName: String(row.student_name || ''),
            college: String(row.college || ''),
            batch: String(row.batch || ''),
            isActive: Boolean(row.is_active),
            accountLinked: Boolean(row.account_linked),
            sessionStatus: row.session_status || null,
            sessionStartedAt: row.session_started_at || null,
            sessionExpiresAt: row.session_expires_at || null,
            deviceBound: Boolean(row.device_bound),
            attemptScore: row.attempt_score ?? null,
            attemptAccuracy:
              row.attempt_accuracy !== null && row.attempt_accuracy !== undefined
                ? Number(row.attempt_accuracy)
                : null,
            attemptElapsedSeconds:
              row.attempt_elapsed_seconds !== null && row.attempt_elapsed_seconds !== undefined
                ? Number(row.attempt_elapsed_seconds)
                : null,
            attemptSubmittedAt: row.attempt_submitted_at || null,
          }))
        : [],
      leaderboard: Array.isArray(r.leaderboard)
        ? r.leaderboard.map((lb: any) => ({
            rank: Number(lb.rank),
            seatNumber: Number(lb.seat_number),
            studentName: String(lb.student_name || ''),
            college: String(lb.college || ''),
            batch: String(lb.batch || ''),
            score: Number(lb.score || 0),
            accuracy: Number(lb.accuracy || 0),
            elapsedSeconds: Number(lb.elapsed_seconds || 0),
            submittedAt: String(lb.submitted_at || ''),
          }))
        : [],
      archives: Array.isArray(r.archives)
        ? r.archives.map((a: any) => ({
            id: String(a.id || ''),
            finaleCode: String(a.finale_code || ''),
            sessionNumber: Number(a.session_number || 1),
            title: String(a.title || ''),
            previousStatus: String(a.previous_status || 'ended'),
            participantCount: Number(a.participant_count || 0),
            submissionCount: Number(a.submission_count || 0),
            publishedAt: a.published_at || null,
            liveStartedAt: a.live_started_at || null,
            endedAt: a.ended_at || null,
            archivedAt: String(a.archived_at || ''),
            archiveReason: String(a.archive_reason || ''),
            standings: Array.isArray(a.standings)
              ? a.standings.map((lb: any) => ({
                  rank: Number(lb.rank),
                  seatNumber: Number(lb.seat_number),
                  studentName: String(lb.student_name || ''),
                  college: String(lb.college || ''),
                  batch: String(lb.batch || ''),
                  score: Number(lb.score || 0),
                  accuracy: Number(lb.accuracy || 0),
                  elapsedSeconds: Number(lb.elapsed_seconds || 0),
                  submittedAt: String(lb.submitted_at || ''),
                }))
              : [],
            questions: normalizeAdminQuestions(a.questions),
          }))
        : [],
      tester: r.tester
        ? {
            displayName: String(r.tester.display_name || 'Classic crew'),
            email: String(r.tester.email || ''),
            isActive: Boolean(r.tester.is_active),
            allowPreLive: Boolean(r.tester.allow_pre_live),
            devices: Array.isArray(r.tester.devices)
              ? r.tester.devices.map((d: any) => ({
                  deviceId: String(d.device_id || ''),
                  deviceLabel: d.device_label || null,
                  userAgent: d.user_agent || null,
                  isAuthorized: Boolean(d.is_authorized),
                  requestedAt: String(d.requested_at || ''),
                  authorizedAt: d.authorized_at || null,
                  revokedAt: d.revoked_at || null,
                  lastSeenAt: String(d.last_seen_at || ''),
                }))
              : [],
            attempts: Array.isArray(r.tester.attempts)
              ? r.tester.attempts.map((a: any) => ({
                  id: String(a.id || ''),
                  sessionId: String(a.session_id || ''),
                  score: Number(a.score || 0),
                  accuracy: Number(a.accuracy || 0),
                  correctCount: Number(a.correct_count || 0),
                  elapsedSeconds: Number(a.elapsed_seconds || 0),
                  isTest: Boolean(a.is_test),
                  deviceId: a.device_id || null,
                  submittedAt: String(a.submitted_at || ''),
                }))
              : [],
          }
        : null,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      finaleCode,
      sessionNumber: 1,
      set: null,
      roster: [],
      leaderboard: [],
      archives: [],
      tester: null,
    };
  }
}

export async function manageFinaleTestDevice(params: {
  deviceId: string;
  action: 'approve' | 'revoke';
  deviceLabel?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_manage_finale_test_device', {
      p_device_id: params.deviceId,
      p_action: params.action,
      p_device_label: params.deviceLabel || null,
    });
    if (error) return { success: false, error: error.message };
    const r = data as { success: boolean; error?: string };
    return r.success ? { success: true } : { success: false, error: r.error || 'Device update failed.' };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function resetFinaleTestSessions(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<{ success: boolean; expiredTestSessions?: number; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('admin_reset_finale_test_sessions', {
      p_finale_code: finaleCode,
    });
    if (error) return { success: false, error: error.message };
    const r = data as { success: boolean; expired_test_sessions?: number; error?: string };
    if (!r.success) return { success: false, error: r.error || 'Reset failed.' };
    return {
      success: true,
      ...(typeof r.expired_test_sessions === 'number' ? { expiredTestSessions: r.expired_test_sessions } : {}),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchFinaleSetAdmin(
  finaleCode: string = CURRENT_FINALE_CODE
): Promise<{ status: string; questions: FinaleQuestionAdminInput[]; published_at?: string } | null> {
  const ov = await fetchFinaleAdminOverview(finaleCode);
  if (!ov.success || !ov.set) return null;
  return {
    status: ov.set.status,
    questions: ov.set.questions,
    ...(ov.set.publishedAt ? { published_at: ov.set.publishedAt } : {}),
  };
}
