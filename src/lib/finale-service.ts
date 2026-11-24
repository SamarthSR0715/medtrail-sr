/**
 * finale-service.ts
 * Student-facing service layer for MedTrail Grand Finale Format B.
 *
 * STRICTLY ISOLATED from championship_pulse_* tables.
 * All RPC names and argument types match the production migration:
 *   supabase/migrations/20261124_championship_finale_format_b.sql
 *
 * RPC catalogue (production signatures):
 *   start_finale_pulse_session_atomic(p_finale_code TEXT)   → JSONB
 *   submit_finale_pulse_attempt_atomic(p_session_id UUID, p_answers JSONB) → JSONB
 *   get_public_finale_roster()                              → TABLE(seat_number, student_name, college, batch)
 *   get_public_finale_leaderboard(p_finale_code TEXT)       → TABLE(rank, seat_number, student_name, college, batch, score, accuracy, elapsed_seconds, submitted_at)
 *
 * Answer encoding (server requirement):
 *   -1 = skipped / not answered
 *    0 = A
 *    1 = B
 *    2 = C
 *    3 = D
 */

import { supabase } from '@/integrations/supabase/client';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_FINALE_CODE = 'FINALE_S1_20261124';
export const FINALE_QUESTION_COUNT = 10;
export const FINALE_DURATION_SECONDS = 90;
export const FINALE_POINTS_PER_CORRECT = 100;
export const FINALE_MAX_SCORE = 1000;

/** sessionStorage key for local answer persistence */
export const FINALE_SESSION_STORAGE_KEY = 'medtrail_finale_session_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Types — derived from actual DB schema / RPC return shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Sanitized question delivered by start_finale_pulse_session_atomic (no correct_answer / explanation). */
export interface FinaleQuestion {
  slot: number;        // 1-based, 1..10
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  subject: string;
}

/** Payload persisted to sessionStorage for refresh-recovery. */
export interface FinaleSessionCache {
  sessionId: string;
  finaleCode: string;
  startedAt: string;   // ISO string
  expiresAt: string;   // ISO string
  seatNumber: number;
  studentName: string;
  questions: FinaleQuestion[];
  answers: number[];   // length 10, each in {-1,0,1,2,3}
  currentSlot: number; // 0-based index
}

/** Result returned from startFinaleSession(). */
export interface StartFinaleResult {
  success: true;
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  durationSeconds: number;
  seatNumber: number;
  studentName: string;
  questions: FinaleQuestion[];
}

/** Error shapes returned by both RPCs. */
export interface FinaleRPCError {
  success: false;
  error?: string;
  notFinalist?: boolean;
  alreadySubmitted?: boolean;
  sessionExpired?: boolean;
  deadlineExceeded?: boolean;
}

export type StartFinaleResponse = StartFinaleResult | FinaleRPCError;

/** Per-question result included in submit response. */
export interface FinaleExplanation {
  slot: number;
  question: string;
  userAnswer: number;    // -1..3
  correctAnswer: string; // 'A'|'B'|'C'|'D'
  explanation: string;
}

/** Result returned from submitFinaleAttempt(). */
export interface SubmitFinaleResult {
  success: true;
  attemptId: string;
  score: number;
  accuracy: number;
  correctCount: number;
  elapsedSeconds: number;
  explanations: FinaleExplanation[];
}

export type SubmitFinaleResponse = SubmitFinaleResult | FinaleRPCError;

/** Public roster entry returned by get_public_finale_roster(). */
export interface FinaleRosterEntry {
  seatNumber: number;
  studentName: string;
  college: string;
  batch: string;
}

/** Leaderboard row returned by get_public_finale_leaderboard(). */
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

interface StartSessionRaw {
  success: boolean;
  error?: string;
  not_finalist?: boolean;
  already_submitted?: boolean;
  session_expired?: boolean;
  session_id?: string;
  started_at?: string;
  expires_at?: string;
  duration_seconds?: number;
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
  }>;
}

interface SubmitAttemptRaw {
  success: boolean;
  error?: string;
  already_submitted?: boolean;
  deadline_exceeded?: boolean;
  attempt_id?: string;
  score?: number;
  accuracy?: number;
  correct_count?: number;
  elapsed_seconds?: number;
  explanations?: Array<{
    slot: number;
    question: string;
    user_answer: number;
    correct_answer: string;
    explanation?: string;
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

interface PublishSetRaw {
  success: boolean;
  error?: string;
  set_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC 2: start_finale_pulse_session_atomic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start or resume a Grand Finale session for the authenticated user.
 *
 * The server validates:
 *   - User is in the approved roster (by user_id or email).
 *   - The question set for finaleCode is published and has exactly 10 questions.
 *   - The user has not already submitted an attempt.
 *   - If a session already exists and has time remaining, it is resumed.
 *
 * Returns sanitized questions (no correct_answer, no explanation).
 */
export async function startFinaleSession(
  finaleCode: string = DEFAULT_FINALE_CODE
): Promise<StartFinaleResponse> {
  try {
    const { data, error } = await (supabase.rpc as any)('start_finale_pulse_session_atomic', {
      p_finale_code: finaleCode,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as StartSessionRaw;

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to start session.',
        notFinalist: Boolean(result.not_finalist),
        alreadySubmitted: Boolean(result.already_submitted),
        sessionExpired: Boolean(result.session_expired),
      };
    }

    // Map snake_case RPC fields → camelCase TypeScript
    const questions = (result.questions || []).map((q) => ({
      slot: q.slot,
      question: q.question,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      subject: q.subject || 'General',
    }));

    return {
      success: true,
      sessionId: result.session_id || '',
      startedAt: result.started_at || '',
      expiresAt: result.expires_at || '',
      durationSeconds: result.duration_seconds || FINALE_DURATION_SECONDS,
      seatNumber: result.seat_number || 0,
      studentName: result.student_name || '',
      questions,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC 3: submit_finale_pulse_attempt_atomic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit answers for a Grand Finale session.
 *
 * @param sessionId  UUID of the active session.
 * @param answers    Array of exactly 10 integers, each in {-1,0,1,2,3}.
 *                   -1 = skipped, 0=A, 1=B, 2=C, 3=D.
 *
 * The server enforces:
 *   - Session belongs to caller.
 *   - Deadline not exceeded (expires_at + 2s tolerance).
 *   - Attempt is immutable after first commit.
 *   - Score = correct_count * 100 (max 1000).
 */
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

  try {
    const { data, error } = await (supabase.rpc as any)('submit_finale_pulse_attempt_atomic', {
      p_session_id: sessionId,
      p_answers: answers,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as SubmitAttemptRaw;

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Submission failed.',
        alreadySubmitted: Boolean(result.already_submitted),
        deadlineExceeded: Boolean(result.deadline_exceeded),
      };
    }

    // Map explanations: snake_case → camelCase
    const rawExpl = result.explanations || [];
    const explanations: FinaleExplanation[] = rawExpl.map((e) => ({
      slot: e.slot,
      question: e.question,
      userAnswer: e.user_answer,
      correctAnswer: e.correct_answer,
      explanation: e.explanation || '',
    }));

    return {
      success: true,
      attemptId: result.attempt_id || '',
      score: result.score || 0,
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
// RPC 4: get_public_finale_roster
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the 10 public-safe finalist slots (name, college, batch only).
 * No PII, no user_ids, no emails.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// RPC 5: get_public_finale_leaderboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the public leaderboard ordered by rank (score DESC, accuracy DESC,
 * elapsed_seconds ASC, submitted_at ASC).
 * No user_ids, no raw answers exposed.
 */
export async function getPublicFinaleLeaderboard(
  finaleCode: string = DEFAULT_FINALE_CODE
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
// Local answer persistence helpers (sessionStorage)
// ─────────────────────────────────────────────────────────────────────────────

/** Persist the current session state for refresh-recovery. */
export function saveFinaleSessionCache(cache: FinaleSessionCache): void {
  try {
    sessionStorage.setItem(FINALE_SESSION_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage unavailable (private browsing edge case) — silent failure.
  }
}

/** Load a cached session. Returns null if none exists or the session has expired. */
export function loadFinaleSessionCache(): FinaleSessionCache | null {
  try {
    const raw = sessionStorage.getItem(FINALE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as FinaleSessionCache;
    // Discard if the session has already expired on the client side.
    if (new Date(cache.expiresAt).getTime() <= Date.now()) {
      clearFinaleSessionCache();
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

/** Clear the cache after submission or expiry. */
export function clearFinaleSessionCache(): void {
  try {
    sessionStorage.removeItem(FINALE_SESSION_STORAGE_KEY);
  } catch {
    // silent
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer encoding helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a 0-based option index (0=A,1=B,2=C,3=D) or null → server integer (-1..3). */
export function encodeAnswer(selected: number | null): number {
  if (selected === null || selected < 0 || selected > 3) return -1;
  return selected;
}

/** Decode a server answer integer → option index (null if skipped). */
export function decodeAnswer(encoded: number): number | null {
  if (encoded < 0 || encoded > 3) return null;
  return encoded;
}

/** Map a correct_answer letter ('A'|'B'|'C'|'D') → 0-based option index. */
export function letterToIndex(letter: string): number {
  return { A: 0, B: 1, C: 2, D: 3 }[letter.toUpperCase()] ?? -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin helpers (publish_finale_set_atomic & set fetching)
// ─────────────────────────────────────────────────────────────────────────────

export interface FinaleQuestionAdminInput {
  slot: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
  subject?: string;
}

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
  }));
}

export async function publishFinaleSet(params: {
  finaleCode?: string;
  questions: FinaleQuestionAdminInput[];
  status?: 'draft' | 'published' | 'closed';
  title?: string;
}): Promise<{ success: boolean; error?: string; setId?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('publish_finale_set_atomic', {
      p_finale_code: params.finaleCode || DEFAULT_FINALE_CODE,
      p_questions: params.questions,
      p_status: params.status || 'published',
      p_title: params.title || 'MedTrail Championship Season 1 Grand Finale',
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const res = data as PublishSetRaw;
    if (!res.success) {
      return { success: false, error: res.error || 'Publish failed' };
    }

    return res.set_id ? { success: true, setId: res.set_id } : { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

export async function fetchFinaleSetAdmin(
  finaleCode: string = DEFAULT_FINALE_CODE
): Promise<{ status: string; questions: FinaleQuestionAdminInput[]; published_at?: string } | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('championship_finale_sets')
      .select('status, questions, published_at')
      .eq('finale_code', finaleCode)
      .maybeSingle();

    if (error || !data) return null;
    return {
      status: data.status,
      questions: Array.isArray(data.questions) ? data.questions : [],
      published_at: data.published_at,
    };
  } catch {
    return null;
  }
}


