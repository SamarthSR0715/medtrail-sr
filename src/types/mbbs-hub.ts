export type PriorityLevel = 'Low' | 'Medium' | 'High';
export type TopicStatus = 'Not Started' | 'In Progress' | 'Completed';
export type GoalStatus = 'Not Started' | 'In Progress' | 'Completed';
export type ExamStatus = 'Upcoming' | 'Completed' | 'Postponed';
export type ExamType = 'University Exam' | 'Internal Assessment' | 'Viva' | 'Quiz' | 'Other';

export interface Profile {
  id: string;
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Subject {
  id: string;
  user_id: string;
  name: string;
  target_topics?: number | null;
  created_at?: string;
  updated_at?: string;
  // Computed client side
  total_topics?: number;
  completed_topics?: number;
}

export interface SubjectGoal {
  id: string;
  user_id: string;
  subject_id?: string | null;
  subject_name: string;
  goal_title?: string | null;
  target_topics: number;
  completed_topics: number;
  progress_percentage: number;
  status: GoalStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SubjectTopic {
  id: string;
  user_id: string;
  subject_id: string;
  title: string;
  status: TopicStatus;
  priority: PriorityLevel;
  estimated_hours: number;
  target_date?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DailyTask {
  id: string;
  user_id: string;
  subject_id?: string | null;
  subject_name?: string | null;
  title: string;
  description?: string | null;
  task_date: string;
  priority: PriorityLevel;
  estimated_minutes: number;
  completed: boolean;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MonthlyGoal {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  month: string; // 'YYYY-MM'
  target_value: number;
  current_value: number;
  completed: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StudyStreak {
  id: string;
  user_id: string;
  study_date: string; // 'YYYY-MM-DD'
  created_at?: string;
}

export interface Exam {
  id: string;
  user_id: string;
  subject_id?: string | null;
  subject_name?: string | null;
  title: string;
  exam_date: string; // 'YYYY-MM-DD'
  exam_type: ExamType;
  status: ExamStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  // Computed
  days_remaining?: number | null;
}

export interface Note {
  id: string;
  user_id: string;
  subject_id?: string | null;
  subject_name?: string | null;
  topic_id?: string | null;
  title: string;
  content: string;
  created_at?: string;
  updated_at?: string;
}

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  totalStudyDays: number;
  studyDates: string[]; // List of YYYY-MM-DD
}

export interface DashboardSummary {
  todayTasks: DailyTask[];
  tasksCompletedToday: number;
  tasksTotalToday: number;
  pendingTasksToday: number;
  dailyCompletionRate: number;
  streakStats: StreakStats;
  monthlyGoalProgressRate: number;
  overallSubjectProgressRate: number;
  upcomingExams: Exam[];
}
