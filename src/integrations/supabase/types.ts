export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      daily_tasks: {
        Row: {
          id: string;
          user_id: string;
          subject_id: string | null;
          title: string;
          task_date: string;
          priority: 'low' | 'medium' | 'high';
          notes: string | null;
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
          description: string | null;
          estimated_time: number | null;
          estimated_minutes: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id?: string | null;
          title: string;
          task_date?: string;
          priority?: 'low' | 'medium' | 'high';
          notes?: string | null;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          description?: string | null;
          estimated_time?: number | null;
          estimated_minutes?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          subject_id?: string | null;
          title?: string;
          task_date?: string;
          priority?: 'low' | 'medium' | 'high';
          notes?: string | null;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          description?: string | null;
          estimated_time?: number | null;
          estimated_minutes?: number | null;
        };
      };
      exams: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          exam_date: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          exam_date: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          exam_date?: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      monthly_goals: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          goal_month: string;
          description: string | null;
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          goal_month: string;
          description?: string | null;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          goal_month?: string;
          description?: string | null;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      notes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          subject_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string;
          subject_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          subject_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      site_updates: {
        Row: {
          id: string;
          title: string;
          content: string;
          created_at: string;
          published: boolean;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          created_at?: string;
          published?: boolean;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          created_at?: string;
          published?: boolean;
        };
      };
      study_days: {
        Row: {
          id: string;
          user_id: string;
          study_date: string;
          tasks_completed: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          study_date: string;
          tasks_completed?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          study_date?: string;
          tasks_completed?: number;
          created_at?: string;
        };
      };
      study_streaks: {
        Row: {
          user_id: string;
          current_streak: number;
          longest_streak: number;
          last_study_date: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          current_streak?: number;
          longest_streak?: number;
          last_study_date?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          current_streak?: number;
          longest_streak?: number;
          last_study_date?: string | null;
          updated_at?: string;
        };
      };
      subjects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      topics: {
        Row: {
          id: string;
          user_id: string;
          subject_id: string;
          title: string;
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id: string;
          title: string;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          subject_id?: string;
          title?: string;
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
