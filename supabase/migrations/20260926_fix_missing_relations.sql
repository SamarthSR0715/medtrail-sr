-- ==============================================================================
-- Migration: 20260926_fix_missing_relations.sql
-- Fixes missing Supabase relations and ensures zero 404 errors for Pulse Studio & Championship
-- ==============================================================================

-- 1. Pulse Settings (Singleton table for dynamic competition timeline)
CREATE TABLE IF NOT EXISTS public.pulse_settings (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    competition_date DATE DEFAULT '2026-09-27',
    start_time TIME DEFAULT '19:00',
    end_time TIME DEFAULT '23:59',
    pulse_status TEXT DEFAULT 'upcoming',
    results_published BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed singleton pulse_settings if empty
INSERT INTO public.pulse_settings (id, competition_date, start_time, end_time, pulse_status, results_published)
VALUES ('singleton', '2026-09-27', '19:00', '23:59', 'upcoming', false)
ON CONFLICT (id) DO NOTHING;

-- 2. App Settings (Key-Value store for global app config)
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed app_settings defaults
INSERT INTO public.app_settings (key, value)
VALUES 
    ('competition_date', '2026-09-27'),
    ('start_time', '19:00'),
    ('end_time', '23:59'),
    ('pulse_status', 'upcoming'),
    ('results_published', 'false')
ON CONFLICT (key) DO NOTHING;

-- 3. Championship Live Ops (Singleton state for live event control)
CREATE TABLE IF NOT EXISTS public.championship_live_ops (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    registration_open BOOLEAN DEFAULT true,
    live_status TEXT DEFAULT 'published',
    target_date TEXT DEFAULT '2026-09-27',
    go_live_time TEXT DEFAULT '19:00',
    end_time TEXT DEFAULT '23:59',
    extended_minutes INTEGER DEFAULT 0,
    is_leaderboard_frozen BOOLEAN DEFAULT false,
    results_declared BOOLEAN DEFAULT false,
    results_declared_at TIMESTAMPTZ,
    emergency_action_log JSONB DEFAULT '[]'::jsonb,
    notifications JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.championship_live_ops (id, registration_open, live_status, target_date, go_live_time, end_time)
VALUES ('singleton', true, 'published', '2026-09-27', '19:00', '23:59')
ON CONFLICT (id) DO NOTHING;

-- 4. Championship Notifications (Broadcast log)
CREATE TABLE IF NOT EXISTS public.championship_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    target_audience TEXT DEFAULT 'all',
    sent_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Championship Hall of Fame
CREATE TABLE IF NOT EXISTS public.championship_hall_of_fame (
    id TEXT PRIMARY KEY DEFAULT 'season_1',
    season_id TEXT DEFAULT 'S1',
    season_title TEXT DEFAULT 'MedTrail Championship: Season 1',
    champion_name TEXT DEFAULT 'Dr. Contender',
    college TEXT DEFAULT 'To be crowned after Season 1',
    batch TEXT DEFAULT 'Season 1 Contender',
    trophy_id TEXT DEFAULT 'MT-S1-001',
    winner_photo TEXT DEFAULT '',
    status TEXT DEFAULT 'To be crowned after Season 1',
    final_score NUMERIC DEFAULT 0,
    accuracy_pct NUMERIC DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    active_tab TEXT DEFAULT 'week_1',
    weekly_data JSONB DEFAULT '{}'::jsonb,
    champions JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.championship_hall_of_fame (id, season_id, season_title, champion_name, college, batch, trophy_id, status)
VALUES ('season_1', 'S1', 'MedTrail Championship: Season 1', 'Dr. Contender', 'To be crowned after Season 1', 'Season 1 Contender', 'MT-S1-001', 'To be crowned after Season 1')
ON CONFLICT (id) DO NOTHING;

-- 6. Device Tokens (FCM push notification tokens)
CREATE TABLE IF NOT EXISTS public.device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    user_id TEXT,
    email TEXT,
    device_info TEXT,
    platform TEXT DEFAULT 'web',
    last_seen TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Championship Pulse Attempts (Student quiz submissions)
CREATE TABLE IF NOT EXISTS public.championship_pulse_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pulse_date TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT,
    student_name TEXT,
    college TEXT,
    score NUMERIC DEFAULT 0,
    time_taken_seconds NUMERIC DEFAULT 0,
    accuracy NUMERIC DEFAULT 0,
    xp NUMERIC DEFAULT 0,
    answers JSONB DEFAULT '[]'::jsonb,
    completed_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Championship Pulse Sets & Questions
CREATE TABLE IF NOT EXISTS public.championship_pulse_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pulse_date TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'published',
    questions JSONB DEFAULT '[]'::jsonb,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.championship_pulse_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pulse_set_id UUID REFERENCES public.championship_pulse_sets(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    question TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation TEXT,
    subject TEXT DEFAULT 'General',
    difficulty TEXT DEFAULT 'Medium',
    xp_value INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- Row Level Security (RLS) & Permissions
-- ==============================================================================

ALTER TABLE public.pulse_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_live_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_hall_of_fame ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_pulse_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_pulse_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_pulse_questions ENABLE ROW LEVEL SECURITY;

-- Public read access
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public read pulse_settings" ON public.pulse_settings;
    CREATE POLICY "Public read pulse_settings" ON public.pulse_settings FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write pulse_settings" ON public.pulse_settings;
    CREATE POLICY "Public write pulse_settings" ON public.pulse_settings FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read app_settings" ON public.app_settings;
    CREATE POLICY "Public read app_settings" ON public.app_settings FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write app_settings" ON public.app_settings;
    CREATE POLICY "Public write app_settings" ON public.app_settings FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read live_ops" ON public.championship_live_ops;
    CREATE POLICY "Public read live_ops" ON public.championship_live_ops FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write live_ops" ON public.championship_live_ops;
    CREATE POLICY "Public write live_ops" ON public.championship_live_ops FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read notifications" ON public.championship_notifications;
    CREATE POLICY "Public read notifications" ON public.championship_notifications FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write notifications" ON public.championship_notifications;
    CREATE POLICY "Public write notifications" ON public.championship_notifications FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read hall_of_fame" ON public.championship_hall_of_fame;
    CREATE POLICY "Public read hall_of_fame" ON public.championship_hall_of_fame FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write hall_of_fame" ON public.championship_hall_of_fame;
    CREATE POLICY "Public write hall_of_fame" ON public.championship_hall_of_fame FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read device_tokens" ON public.device_tokens;
    CREATE POLICY "Public read device_tokens" ON public.device_tokens FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write device_tokens" ON public.device_tokens;
    CREATE POLICY "Public write device_tokens" ON public.device_tokens FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read pulse_attempts" ON public.championship_pulse_attempts;
    CREATE POLICY "Public read pulse_attempts" ON public.championship_pulse_attempts FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write pulse_attempts" ON public.championship_pulse_attempts;
    CREATE POLICY "Public write pulse_attempts" ON public.championship_pulse_attempts FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read pulse_sets" ON public.championship_pulse_sets;
    CREATE POLICY "Public read pulse_sets" ON public.championship_pulse_sets FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write pulse_sets" ON public.championship_pulse_sets;
    CREATE POLICY "Public write pulse_sets" ON public.championship_pulse_sets FOR ALL USING (true);

    DROP POLICY IF EXISTS "Public read pulse_questions" ON public.championship_pulse_questions;
    CREATE POLICY "Public read pulse_questions" ON public.championship_pulse_questions FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Public write pulse_questions" ON public.championship_pulse_questions;
    CREATE POLICY "Public write pulse_questions" ON public.championship_pulse_questions FOR ALL USING (true);
END $$;

-- Enable Realtime publication for all active tables
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pulse_settings;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_live_ops;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_hall_of_fame;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.championship_pulse_attempts;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
