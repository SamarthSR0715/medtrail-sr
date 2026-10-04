-- ==============================================================================
-- Migration: 20261004_overall_championship_leaderboard.sql
-- Description:
--   Add admin-only Overall Championship Leaderboard RPC functions.
--
-- ADDITIVE ONLY — no tables created, altered, or dropped.
-- Existing leaderboard, pulse attempt, student dashboard, and public APIs
-- are completely untouched.
--
-- Functions added:
--   1. get_overall_championship_leaderboard(p_filters jsonb)
--      — Aggregates per-student cumulative stats across selected pulses/dates.
--      — Admin-only (enforced server-side via is_admin()).
--
--   2. get_overall_college_standings(p_filters jsonb)
--      — Aggregates per-college cumulative stats across selected pulses/dates.
--      — Canonical college resolution via medical_colleges master table.
--      — Admin-only (enforced server-side via is_admin()).
--
--   3. get_available_pulse_list()
--      — Returns all published pulse IDs + dates available for filter dropdowns.
--      — Admin-only.
--
-- Indexes added (covering, non-blocking):
--   - idx_champ_lb_user_pulse_score    on championship_leaderboard(user_id, pulse_id, score)
--   - idx_champ_lb_submitted_at        on championship_leaderboard(submitted_at)
--   - idx_champ_pa_pulse_user          on championship_pulse_attempts(pulse_id, user_id)
-- ==============================================================================

BEGIN;

-- ── 1. Supporting indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_champ_lb_user_pulse_score
  ON public.championship_leaderboard (user_id, pulse_id, score DESC);

CREATE INDEX IF NOT EXISTS idx_champ_lb_submitted_at
  ON public.championship_leaderboard (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_champ_pa_pulse_user
  ON public.championship_pulse_attempts (pulse_id, user_id);

-- ── 2. get_overall_championship_leaderboard ────────────────────────────────────
-- Aggregates per-student cumulative performance across selected pulses/dates.
-- Admin-only. Students and anonymous callers receive an authorization error.
--
-- Filter contract (p_filters jsonb):
--   start_date     text      | null  — ISO date (inclusive, IST timezone-aware)
--   end_date       text      | null  — ISO date (inclusive, IST timezone-aware)
--   pulse_ids      text[]    | null  — specific pulse UUIDs or pulse_date strings; null = all
--   college_filter text      | null  — college name; null = all
--   batch_filter   text      | null  — batch string; null = all
--   min_attempts   integer   | null  — minimum eligible attempt count; null = 1
--   ranking_metric text      | null  — "total_score" | "avg_score" | "accuracy"; null = "total_score"
--   page           integer   | null  — 1-based page; null = 1
--   page_size      integer   | null  — rows per page; null = 50 (max 200)
--
-- Returns: jsonb with { ok, error?, data: row[], total_count, last_calculated_at }

CREATE OR REPLACE FUNCTION public.get_overall_championship_leaderboard(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin          boolean;
  v_start_date        date;
  v_end_date          date;
  v_pulse_ids         text[];
  v_college_filter    text;
  v_batch_filter      text;
  v_min_attempts      integer;
  v_ranking_metric    text;
  v_page              integer;
  v_page_size         integer;
  v_offset            integer;
  v_rows              jsonb;
  v_total_count       bigint;
  v_now               timestamptz := now();
BEGIN
  -- ── Authorization ────────────────────────────────────────────────────────────
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Unauthorized: Administrator privileges required to access the Overall Championship Leaderboard.'
    );
  END IF;

  -- ── Parse filters ────────────────────────────────────────────────────────────
  v_start_date     := NULLIF(trim(coalesce(p_filters->>'start_date', '')), '')::date;
  v_end_date       := NULLIF(trim(coalesce(p_filters->>'end_date', '')), '')::date;
  v_college_filter := NULLIF(trim(coalesce(p_filters->>'college_filter', '')), '');
  v_batch_filter   := NULLIF(trim(coalesce(p_filters->>'batch_filter', '')), '');
  v_ranking_metric := coalesce(NULLIF(trim(coalesce(p_filters->>'ranking_metric', '')), ''), 'total_score');
  v_min_attempts   := coalesce((p_filters->>'min_attempts')::integer, 1);
  v_page           := greatest(1, coalesce((p_filters->>'page')::integer, 1));
  v_page_size      := least(200, greatest(1, coalesce((p_filters->>'page_size')::integer, 50)));
  v_offset         := (v_page - 1) * v_page_size;

  -- Parse pulse_ids array (handles UUID strings or date strings)
  IF p_filters ? 'pulse_ids' AND jsonb_typeof(p_filters->'pulse_ids') = 'array' THEN
    SELECT array_agg(elem #>> '{}')
    INTO v_pulse_ids
    FROM jsonb_array_elements(p_filters->'pulse_ids') elem;

    IF v_pulse_ids IS NOT NULL AND cardinality(v_pulse_ids) = 0 THEN
      v_pulse_ids := NULL;
    END IF;
  END IF;

  -- Validate ranking metric
  IF v_ranking_metric NOT IN ('total_score', 'avg_score', 'accuracy') THEN
    v_ranking_metric := 'total_score';
  END IF;

  -- ── Core aggregation query ────────────────────────────────────────────────────
  WITH eligible_lb AS (
    SELECT
      l.user_id,
      l.student_name,
      COALESCE(mc.college_name, l.college) AS college,
      l.batch,
      l.score,
      l.accuracy,
      l.time_taken_seconds,
      l.submitted_at,
      l.pulse_id,
      -- Correlated subquery with LIMIT 1 guarantees zero row multiplication
      COALESCE(
        (
          SELECT COALESCE(pa.xp, 0)
          FROM public.championship_pulse_attempts pa
          WHERE (pa.user_id::text = l.user_id OR (l.user_email IS NOT NULL AND lower(pa.user_email) = lower(l.user_email)))
            AND (pa.pulse_id = l.pulse_id OR pa.pulse_date::text = l.pulse_id)
          ORDER BY pa.submitted_at DESC NULLS LAST
          LIMIT 1
        ),
        0
      ) AS attempt_xp
    FROM public.championship_leaderboard l
    LEFT JOIN public.medical_colleges mc ON mc.id = l.medical_college_id
    WHERE
      -- Exclude removed registrations if record exists
      NOT EXISTS (
        SELECT 1 FROM public.championship_registrations reg
        WHERE (reg.user_id::text = l.user_id OR (l.user_email IS NOT NULL AND lower(reg.email) = lower(l.user_email)))
          AND reg.approval_status = 'removed'
      )
      -- Date range filter in Asia/Kolkata timezone
      AND (v_start_date IS NULL OR (l.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= v_start_date)
      AND (v_end_date IS NULL OR (l.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= v_end_date)
      -- Pulse selection filter (matches pulse_id directly or by corresponding pulse set)
      AND (
        v_pulse_ids IS NULL 
        OR l.pulse_id = ANY(v_pulse_ids)
        OR EXISTS (
          SELECT 1 FROM public.championship_pulse_sets ps_filter
          WHERE (ps_filter.id::text = ANY(v_pulse_ids) OR ps_filter.pulse_date::text = ANY(v_pulse_ids))
            AND (l.pulse_id = ps_filter.id::text OR l.pulse_id = ps_filter.pulse_date::text)
        )
      )
      -- College filter (matches canonical or raw name, case-insensitive)
      AND (
        v_college_filter IS NULL 
        OR lower(trim(COALESCE(mc.college_name, l.college))) = lower(trim(v_college_filter))
        OR lower(trim(l.college)) = lower(trim(v_college_filter))
      )
      -- Batch filter
      AND (v_batch_filter IS NULL OR lower(trim(l.batch)) = lower(trim(v_batch_filter)))
  ),
  -- Per-student aggregates
  student_agg AS (
    SELECT
      e.user_id,
      (array_agg(e.student_name ORDER BY e.submitted_at DESC))[1]   AS student_name,
      (array_agg(e.college      ORDER BY e.submitted_at DESC))[1]   AS college,
      (array_agg(e.batch        ORDER BY e.submitted_at DESC))[1]   AS batch,
      COUNT(DISTINCT e.pulse_id)                                     AS attempts_count,
      SUM(e.score)                                                   AS total_score,
      ROUND(AVG(e.score), 2)                                         AS avg_score,
      MAX(e.score)                                                   AS best_score,
      ROUND(AVG(e.accuracy), 2)                                      AS overall_accuracy,
      ROUND(AVG(e.time_taken_seconds), 1)                            AS avg_time_seconds,
      SUM(e.attempt_xp)                                              AS total_xp,
      (array_agg(e.score ORDER BY e.submitted_at DESC))[1]          AS latest_score,
      (array_agg(e.score ORDER BY e.submitted_at DESC))[2]          AS prev_score,
      MAX(e.submitted_at)                                            AS last_attempt_at
    FROM eligible_lb e
    GROUP BY e.user_id
    HAVING COUNT(DISTINCT e.pulse_id) >= v_min_attempts
  ),
  -- Ranking
  student_ranked AS (
    SELECT
      s.*,
      COALESCE(s.latest_score, 0) - COALESCE(s.prev_score, 0)       AS score_change,
      CASE
        WHEN s.prev_score IS NOT NULL AND s.prev_score > 0
        THEN ROUND(
          ((s.latest_score - s.prev_score)::numeric / s.prev_score::numeric) * 100, 2
        )
        ELSE NULL
      END                                                            AS pct_change,
      -- Shared rank on genuine tie via DENSE_RANK
      DENSE_RANK() OVER (
        ORDER BY
          CASE v_ranking_metric
            WHEN 'total_score' THEN s.total_score
            WHEN 'avg_score'   THEN s.avg_score
            WHEN 'accuracy'    THEN s.overall_accuracy
            ELSE s.total_score
          END DESC,
          s.overall_accuracy DESC,
          s.avg_score DESC,
          s.avg_time_seconds ASC NULLS LAST
      ) AS rank,
      -- Strictly monotonic row number for pagination slicing
      ROW_NUMBER() OVER (
        ORDER BY
          CASE v_ranking_metric
            WHEN 'total_score' THEN s.total_score
            WHEN 'avg_score'   THEN s.avg_score
            WHEN 'accuracy'    THEN s.overall_accuracy
            ELSE s.total_score
          END DESC,
          s.overall_accuracy DESC,
          s.avg_score DESC,
          s.avg_time_seconds ASC NULLS LAST,
          s.last_attempt_at ASC NULLS LAST,
          s.user_id ASC
      ) AS row_num
    FROM student_agg s
  )
  -- Final: paginated result + total count
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'rank',             r.rank,
        'user_id',          r.user_id,
        'student_name',     r.student_name,
        'college',          r.college,
        'batch',            r.batch,
        'attempts_count',   r.attempts_count,
        'total_score',      r.total_score,
        'avg_score',        r.avg_score,
        'best_score',       r.best_score,
        'overall_accuracy', r.overall_accuracy,
        'avg_time_seconds', r.avg_time_seconds,
        'total_xp',         r.total_xp,
        'latest_score',     r.latest_score,
        'prev_score',       r.prev_score,
        'score_change',     r.score_change,
        'pct_change',       r.pct_change,
        'last_attempt_at',  r.last_attempt_at
      )
      ORDER BY r.row_num
    ) FILTER (WHERE r.row_num > v_offset AND r.row_num <= v_offset + v_page_size),
    COUNT(*)
  INTO v_rows, v_total_count
  FROM student_ranked r;

  RETURN jsonb_build_object(
    'ok',                true,
    'data',              COALESCE(v_rows, '[]'::jsonb),
    'total_count',       COALESCE(v_total_count, 0),
    'page',              v_page,
    'page_size',         v_page_size,
    'ranking_metric',    v_ranking_metric,
    'last_calculated_at', v_now
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok',    false,
    'error', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_overall_championship_leaderboard(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_overall_championship_leaderboard(jsonb) TO authenticated, service_role;

-- ── 3. get_overall_college_standings ──────────────────────────────────────────
-- Admin-only college aggregates across selected pulses/dates.
-- Uses canonical college master table resolution to prevent fragmented standings.

CREATE OR REPLACE FUNCTION public.get_overall_college_standings(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin          boolean;
  v_start_date        date;
  v_end_date          date;
  v_pulse_ids         text[];
  v_batch_filter      text;
  v_result            jsonb;
  v_now               timestamptz := now();
BEGIN
  -- ── Authorization ────────────────────────────────────────────────────────────
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Unauthorized: Administrator privileges required.'
    );
  END IF;

  -- ── Parse filters ────────────────────────────────────────────────────────────
  v_start_date   := NULLIF(trim(coalesce(p_filters->>'start_date', '')), '')::date;
  v_end_date     := NULLIF(trim(coalesce(p_filters->>'end_date', '')), '')::date;
  v_batch_filter := NULLIF(trim(coalesce(p_filters->>'batch_filter', '')), '');

  IF p_filters ? 'pulse_ids' AND jsonb_typeof(p_filters->'pulse_ids') = 'array' THEN
    SELECT array_agg(elem #>> '{}')
    INTO v_pulse_ids
    FROM jsonb_array_elements(p_filters->'pulse_ids') elem;

    IF v_pulse_ids IS NOT NULL AND cardinality(v_pulse_ids) = 0 THEN
      v_pulse_ids := NULL;
    END IF;
  END IF;

  WITH eligible_lb AS (
    SELECT
      l.user_id,
      COALESCE(mc.college_name, l.college)          AS college,
      COALESCE(mc.id::text, lower(trim(l.college))) AS college_key,
      l.batch,
      l.score,
      l.accuracy,
      l.student_name,
      l.pulse_id,
      l.submitted_at
    FROM public.championship_leaderboard l
    LEFT JOIN public.medical_colleges mc ON mc.id = l.medical_college_id
    WHERE
      NOT EXISTS (
        SELECT 1 FROM public.championship_registrations reg
        WHERE (reg.user_id::text = l.user_id OR (l.user_email IS NOT NULL AND lower(reg.email) = lower(l.user_email)))
          AND reg.approval_status = 'removed'
      )
      AND (v_start_date IS NULL OR (l.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= v_start_date)
      AND (v_end_date IS NULL OR (l.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= v_end_date)
      AND (
        v_pulse_ids IS NULL 
        OR l.pulse_id = ANY(v_pulse_ids)
        OR EXISTS (
          SELECT 1 FROM public.championship_pulse_sets ps_filter
          WHERE (ps_filter.id::text = ANY(v_pulse_ids) OR ps_filter.pulse_date::text = ANY(v_pulse_ids))
            AND (l.pulse_id = ps_filter.id::text OR l.pulse_id = ps_filter.pulse_date::text)
        )
      )
      AND (v_batch_filter IS NULL OR lower(trim(l.batch)) = lower(trim(v_batch_filter)))
  ),
  college_agg AS (
    SELECT
      (array_agg(e.college ORDER BY e.submitted_at DESC))[1]          AS college,
      COUNT(DISTINCT e.user_id)                                      AS student_count,
      COUNT(DISTINCT e.pulse_id)                                     AS total_attempts,
      SUM(e.score)                                                   AS combined_score,
      ROUND(AVG(e.score), 2)                                         AS avg_score,
      ROUND(AVG(e.accuracy), 2)                                      AS overall_accuracy,
      -- Top performer by total score, tie-broken by accuracy
      (
        SELECT sub.student_name
        FROM eligible_lb sub
        WHERE sub.college_key = e.college_key
        GROUP BY sub.user_id, sub.student_name
        ORDER BY SUM(sub.score) DESC, AVG(sub.accuracy) DESC
        LIMIT 1
      )                                                              AS top_student
    FROM eligible_lb e
    GROUP BY e.college_key
  ),
  college_ranked AS (
    SELECT
      c.*,
      DENSE_RANK() OVER (
        ORDER BY c.combined_score DESC, c.overall_accuracy DESC, c.avg_score DESC
      ) AS rank
    FROM college_agg c
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'rank',             r.rank,
      'college',          r.college,
      'student_count',    r.student_count,
      'total_attempts',   r.total_attempts,
      'combined_score',   r.combined_score,
      'avg_score',        r.avg_score,
      'overall_accuracy', r.overall_accuracy,
      'top_student',      COALESCE(r.top_student, '—')
    )
    ORDER BY r.rank
  )
  INTO v_result
  FROM college_ranked r;

  RETURN jsonb_build_object(
    'ok',                true,
    'data',              COALESCE(v_result, '[]'::jsonb),
    'last_calculated_at', v_now
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.get_overall_college_standings(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_overall_college_standings(jsonb) TO authenticated, service_role;

-- ── 4. get_available_pulse_list ───────────────────────────────────────────────
-- Returns all published pulse IDs with their dates, for filter dropdown population.
-- Admin-only.

CREATE OR REPLACE FUNCTION public.get_available_pulse_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_result   jsonb;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  END IF;

  -- Pulses that are published
  SELECT jsonb_agg(
    jsonb_build_object(
      'pulse_id',   ps.id,
      'pulse_date', ps.pulse_date,
      'status',     ps.status,
      'submission_count', COALESCE(lb_counts.cnt, 0)
    )
    ORDER BY ps.pulse_date DESC
  )
  INTO v_result
  FROM public.championship_pulse_sets ps
  LEFT JOIN (
    SELECT pulse_id, COUNT(*) AS cnt
    FROM public.championship_leaderboard
    GROUP BY pulse_id
  ) lb_counts ON (lb_counts.pulse_id = ps.id::text OR lb_counts.pulse_id = ps.pulse_date::text)
  WHERE ps.status = 'published';

  RETURN jsonb_build_object(
    'ok',   true,
    'data', COALESCE(v_result, '[]'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_pulse_list() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_available_pulse_list() TO authenticated, service_role;

COMMIT;
