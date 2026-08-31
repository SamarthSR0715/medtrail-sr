-- MBBS Hub Database Migration Schema with Row Level Security (RLS)
-- Run this in your Supabase SQL Editor if these tables do not exist yet.

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Subjects Table
CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  target_topics INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Subject Goals Table (One goal per subject + progress % and targets)
CREATE TABLE IF NOT EXISTS public.subject_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL,
  goal_title TEXT,
  target_topics INT DEFAULT 10,
  completed_topics INT DEFAULT 0,
  progress_percentage INT DEFAULT 0,
  status TEXT DEFAULT 'In Progress', -- 'Not Started', 'In Progress', 'Completed'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Subject Topics Table
CREATE TABLE IF NOT EXISTS public.subject_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'Not Started', -- 'Not Started', 'In Progress', 'Completed'
  priority TEXT DEFAULT 'Medium',
  estimated_hours NUMERIC DEFAULT 1,
  target_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Daily Tasks Table (CRUD + checkbox completion)
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  subject_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  task_date DATE DEFAULT CURRENT_DATE,
  priority TEXT DEFAULT 'Medium', -- 'Low', 'Medium', 'High'
  estimated_minutes INT DEFAULT 30,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Monthly Goals Table (CRUD + progress)
CREATE TABLE IF NOT EXISTS public.monthly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  month TEXT NOT NULL, -- e.g. '2026-08'
  target_value INT DEFAULT 100,
  current_value INT DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Study Streaks Table (Automatic daily streak based on completed task)
CREATE TABLE IF NOT EXISTS public.study_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  study_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_user_study_date UNIQUE (user_id, study_date)
);

-- 8. Exams Table (Title, subject, date, status, exam_type, notes)
CREATE TABLE IF NOT EXISTS public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  subject_name TEXT,
  title TEXT NOT NULL,
  exam_date DATE NOT NULL,
  exam_type TEXT DEFAULT 'University Exam', -- 'University Exam', 'Internal Assessment', 'Viva', 'Quiz', 'Other'
  status TEXT DEFAULT 'Upcoming', -- 'Upcoming', 'Completed', 'Postponed'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Notes Table (Title, content, subject)
CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  subject_name TEXT,
  topic_id UUID REFERENCES public.subject_topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies ensuring users can ONLY access their own rows
DO $$
BEGIN
  -- Profiles
  DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;
  CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Subjects
  DROP POLICY IF EXISTS "Users can manage own subjects" ON public.subjects;
  CREATE POLICY "Users can manage own subjects" ON public.subjects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Subject Goals
  DROP POLICY IF EXISTS "Users can manage own subject goals" ON public.subject_goals;
  CREATE POLICY "Users can manage own subject goals" ON public.subject_goals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Subject Topics
  DROP POLICY IF EXISTS "Users can manage own topics" ON public.subject_topics;
  CREATE POLICY "Users can manage own topics" ON public.subject_topics FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Daily Tasks
  DROP POLICY IF EXISTS "Users can manage own tasks" ON public.daily_tasks;
  CREATE POLICY "Users can manage own tasks" ON public.daily_tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Monthly Goals
  DROP POLICY IF EXISTS "Users can manage own goals" ON public.monthly_goals;
  CREATE POLICY "Users can manage own goals" ON public.monthly_goals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Study Streaks
  DROP POLICY IF EXISTS "Users can manage own streaks" ON public.study_streaks;
  CREATE POLICY "Users can manage own streaks" ON public.study_streaks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Exams
  DROP POLICY IF EXISTS "Users can manage own exams" ON public.exams;
  CREATE POLICY "Users can manage own exams" ON public.exams FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  -- Notes
  DROP POLICY IF EXISTS "Users can manage own notes" ON public.notes;
  CREATE POLICY "Users can manage own notes" ON public.notes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
END $$;

-- Trigger to auto-create profile on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
