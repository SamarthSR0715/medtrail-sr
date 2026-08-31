-- MedTrailSR MBBS Hub Database Schema Fix Migration
-- Idempotent script: Creates tables if missing and adds missing columns safely without deleting any data.

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
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  task_date DATE DEFAULT CURRENT_DATE,
  priority TEXT DEFAULT 'Medium',
  estimated_minutes INT DEFAULT 30,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS task_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS estimated_minutes INT DEFAULT 30;
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;
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
  user_id REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
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

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_streaks ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies: Allow users to select, insert, update, and delete their own rows
DO $$
BEGIN
  -- Profiles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can manage own profile') THEN
    CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Subjects
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'Users can manage own subjects') THEN
    CREATE POLICY "Users can manage own subjects" ON public.subjects FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Daily Tasks
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tasks' AND policyname = 'Users can manage own tasks') THEN
    CREATE POLICY "Users can manage own tasks" ON public.daily_tasks FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Monthly Goals
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'monthly_goals' AND policyname = 'Users can manage own goals') THEN
    CREATE POLICY "Users can manage own goals" ON public.monthly_goals FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Subject Goals
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subject_goals' AND policyname = 'Users can manage own subject goals') THEN
    CREATE POLICY "Users can manage own subject goals" ON public.subject_goals FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Exams
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exams' AND policyname = 'Users can manage own exams') THEN
    CREATE POLICY "Users can manage own exams" ON public.exams FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Notes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can manage own notes') THEN
    CREATE POLICY "Users can manage own notes" ON public.notes FOR ALL USING (auth.uid() = user_id);
  END IF;

  -- Study Streaks
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'study_streaks' AND policyname = 'Users can manage own streaks') THEN
    CREATE POLICY "Users can manage own streaks" ON public.study_streaks FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
