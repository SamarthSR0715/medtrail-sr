-- Comprehensive Fix for MBBS Hub Tables & Row Level Security (RLS)
-- Run this migration in your Supabase SQL Editor.

-- Grant permissions to authenticated and service_role users
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. SUBJECTS TABLE
CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  target_topics INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS target_topics INT DEFAULT 10;
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. DAILY TASKS TABLE
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'Medium',
  estimated_time INT DEFAULT 30,
  estimated_minutes INT DEFAULT 30,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  task_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS estimated_time INT DEFAULT 30;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS estimated_minutes INT DEFAULT 30;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS task_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 4. MONTHLY GOALS TABLE
CREATE TABLE IF NOT EXISTS public.monthly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  month TEXT NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM'),
  target_value INT DEFAULT 100,
  current_value INT DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS month TEXT DEFAULT to_char(CURRENT_DATE, 'YYYY-MM');
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS target_value INT DEFAULT 100;
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS current_value INT DEFAULT 0;
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.monthly_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 5. SUBJECT GOALS TABLE
CREATE TABLE IF NOT EXISTS public.subject_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_name TEXT NOT NULL,
  goal_title TEXT,
  target_topics INT DEFAULT 10,
  completed_topics INT DEFAULT 0,
  progress_percentage INT DEFAULT 0,
  status TEXT DEFAULT 'In Progress',
  notes TEXT,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS goal_title TEXT;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS target_topics INT DEFAULT 10;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS completed_topics INT DEFAULT 0;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS progress_percentage INT DEFAULT 0;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'In Progress';
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.subject_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 6. EXAMS TABLE
CREATE TABLE IF NOT EXISTS public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  exam_date DATE NOT NULL DEFAULT CURRENT_DATE,
  exam_type TEXT DEFAULT 'University Exam',
  status TEXT DEFAULT 'Upcoming',
  notes TEXT,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS exam_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS exam_type TEXT DEFAULT 'University Exam';
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Upcoming';
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 7. NOTES TABLE
CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS topic_id UUID;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 8. STUDY STREAKS TABLE
CREATE TABLE IF NOT EXISTS public.study_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  study_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_user_study_date UNIQUE (user_id, study_date)
);

-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_streaks ENABLE ROW LEVEL SECURITY;

-- DROP ANY RESTRICTIVE OLD POLICIES TO PREVENT 403 CONFLICTS
DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can manage own subjects" ON public.subjects;
DROP POLICY IF EXISTS "Users can manage own tasks" ON public.daily_tasks;
DROP POLICY IF EXISTS "Users can manage own goals" ON public.monthly_goals;
DROP POLICY IF EXISTS "Users can manage own subject goals" ON public.subject_goals;
DROP POLICY IF EXISTS "Users can manage own exams" ON public.exams;
DROP POLICY IF EXISTS "Users can manage own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can manage own streaks" ON public.study_streaks;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;

DROP POLICY IF EXISTS "subjects_select" ON public.subjects;
DROP POLICY IF EXISTS "subjects_insert" ON public.subjects;
DROP POLICY IF EXISTS "subjects_update" ON public.subjects;
DROP POLICY IF EXISTS "subjects_delete" ON public.subjects;

DROP POLICY IF EXISTS "daily_tasks_select" ON public.daily_tasks;
DROP POLICY IF EXISTS "daily_tasks_insert" ON public.daily_tasks;
DROP POLICY IF EXISTS "daily_tasks_update" ON public.daily_tasks;
DROP POLICY IF EXISTS "daily_tasks_delete" ON public.daily_tasks;

DROP POLICY IF EXISTS "monthly_goals_select" ON public.monthly_goals;
DROP POLICY IF EXISTS "monthly_goals_insert" ON public.monthly_goals;
DROP POLICY IF EXISTS "monthly_goals_update" ON public.monthly_goals;
DROP POLICY IF EXISTS "monthly_goals_delete" ON public.monthly_goals;

DROP POLICY IF EXISTS "subject_goals_select" ON public.subject_goals;
DROP POLICY IF EXISTS "subject_goals_insert" ON public.subject_goals;
DROP POLICY IF EXISTS "subject_goals_update" ON public.subject_goals;
DROP POLICY IF EXISTS "subject_goals_delete" ON public.subject_goals;

DROP POLICY IF EXISTS "exams_select" ON public.exams;
DROP POLICY IF EXISTS "exams_insert" ON public.exams;
DROP POLICY IF EXISTS "exams_update" ON public.exams;
DROP POLICY IF EXISTS "exams_delete" ON public.exams;

DROP POLICY IF EXISTS "notes_select" ON public.notes;
DROP POLICY IF EXISTS "notes_insert" ON public.notes;
DROP POLICY IF EXISTS "notes_update" ON public.notes;
DROP POLICY IF EXISTS "notes_delete" ON public.notes;

DROP POLICY IF EXISTS "study_streaks_select" ON public.study_streaks;
DROP POLICY IF EXISTS "study_streaks_insert" ON public.study_streaks;
DROP POLICY IF EXISTS "study_streaks_update" ON public.study_streaks;
DROP POLICY IF EXISTS "study_streaks_delete" ON public.study_streaks;

-- CREATE EXPLICIT, UNRESTRICTED CRUD POLICIES (SELECT, INSERT, UPDATE, DELETE)

-- 1. Profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE USING (auth.uid() = user_id);

-- 2. Subjects
CREATE POLICY "subjects_select" ON public.subjects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subjects_insert" ON public.subjects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subjects_update" ON public.subjects FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subjects_delete" ON public.subjects FOR DELETE USING (auth.uid() = user_id);

-- 3. Daily Tasks
CREATE POLICY "daily_tasks_select" ON public.daily_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_tasks_insert" ON public.daily_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "daily_tasks_update" ON public.daily_tasks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "daily_tasks_delete" ON public.daily_tasks FOR DELETE USING (auth.uid() = user_id);

-- 4. Monthly Goals
CREATE POLICY "monthly_goals_select" ON public.monthly_goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "monthly_goals_insert" ON public.monthly_goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "monthly_goals_update" ON public.monthly_goals FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "monthly_goals_delete" ON public.monthly_goals FOR DELETE USING (auth.uid() = user_id);

-- 5. Subject Goals
CREATE POLICY "subject_goals_select" ON public.subject_goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subject_goals_insert" ON public.subject_goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subject_goals_update" ON public.subject_goals FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subject_goals_delete" ON public.subject_goals FOR DELETE USING (auth.uid() = user_id);

-- 6. Exams
CREATE POLICY "exams_select" ON public.exams FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "exams_insert" ON public.exams FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exams_update" ON public.exams FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exams_delete" ON public.exams FOR DELETE USING (auth.uid() = user_id);

-- 7. Notes
CREATE POLICY "notes_select" ON public.notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notes_insert" ON public.notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes_update" ON public.notes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes_delete" ON public.notes FOR DELETE USING (auth.uid() = user_id);

-- 8. Study Streaks
CREATE POLICY "study_streaks_select" ON public.study_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "study_streaks_insert" ON public.study_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "study_streaks_update" ON public.study_streaks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "study_streaks_delete" ON public.study_streaks FOR DELETE USING (auth.uid() = user_id);
