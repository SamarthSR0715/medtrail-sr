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
      championship_participants: {
        Row: {
          id: string;
          user_id: string;
          season_id: string;
          display_name: string;
          display_name_type: 'full_name' | 'display_name' | 'pseudonym';
          full_name: string;
          student_id: string | null;
          institution: string;
          country: string;
          show_institution: boolean;
          show_country: boolean;
          show_score: boolean;
          status: 'active' | 'suspended' | 'disqualified' | 'withdrawn';
          consent_policy_version: string;
          consent_given_at: string;
          rules_accepted: boolean;
          fair_play_accepted: boolean;
          privacy_accepted: boolean;
          eligibility_confirmed: boolean;
          info_accurate_confirmed: boolean;
          parental_consent: boolean | null;
          is_minor: boolean;
          total_score: number;
          total_pulses_done: number;
          total_accuracy_pct: number;
          current_streak: number;
          last_active_at: string | null;
          registered_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          season_id?: string;
          display_name: string;
          display_name_type: 'full_name' | 'display_name' | 'pseudonym';
          full_name: string;
          student_id?: string | null;
          institution: string;
          country?: string;
          show_institution?: boolean;
          show_country?: boolean;
          show_score?: boolean;
          status?: 'active' | 'suspended' | 'disqualified' | 'withdrawn';
          consent_policy_version?: string;
          consent_given_at?: string;
          rules_accepted: boolean;
          fair_play_accepted: boolean;
          privacy_accepted: boolean;
          eligibility_confirmed: boolean;
          info_accurate_confirmed: boolean;
          parental_consent?: boolean | null;
          is_minor?: boolean;
          total_score?: number;
          total_pulses_done?: number;
          total_accuracy_pct?: number;
          current_streak?: number;
          last_active_at?: string | null;
          registered_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          display_name_type?: 'full_name' | 'display_name' | 'pseudonym';
          institution?: string;
          country?: string;
          show_institution?: boolean;
          show_country?: boolean;
          show_score?: boolean;
          status?: 'active' | 'suspended' | 'disqualified' | 'withdrawn';
          total_score?: number;
          total_pulses_done?: number;
          total_accuracy_pct?: number;
          current_streak?: number;
          last_active_at?: string | null;
          updated_at?: string;
        };
      };
      championship_pulse_completions: {
        Row: {
          id: string;
          idempotency_key: string;
          participant_id: string;
          user_id: string;
          season_id: string;
          pulse_date: string;
          pulse_slot: number;
          pulse_type: 'mbbs' | 'general';
          pulse_category: string | null;
          submitted_at: string;
          time_taken_seconds: number | null;
          validation_status: 'pending' | 'valid' | 'rejected' | 'flagged';
          validated_at: string | null;
          rejection_reason: string | null;
          score_awarded: number;
          max_score: number;
          accuracy_pct: number | null;
          answers_correct: number | null;
          answers_total: number | null;
          is_suspicious: boolean;
          is_duplicate: boolean;
          created_at: string;
        };
        Insert: {
          idempotency_key: string;
          participant_id: string;
          user_id: string;
          season_id?: string;
          pulse_date: string;
          pulse_slot: number;
          pulse_type: 'mbbs' | 'general';
          pulse_category?: string | null;
          submitted_at?: string;
          time_taken_seconds?: number | null;
          validation_status?: 'pending' | 'valid' | 'rejected' | 'flagged';
          score_awarded?: number;
          accuracy_pct?: number | null;
          answers_correct?: number | null;
          answers_total?: number | null;
        };
        Update: Record<string, never>;
      };
      championship_disputes: {
        Row: {
          id: string;
          reference_number: string;
          participant_id: string;
          user_id: string;
          dispute_type: string;
          affected_event_id: string | null;
          description: string;
          evidence_notes: string | null;
          status: 'submitted' | 'under_review' | 'resolved' | 'rejected' | 'escalated';
          submitted_at: string;
          deadline_at: string;
          reviewed_at: string | null;
          reviewer_notes: string | null;
          decision: string | null;
          correction_applied: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          participant_id: string;
          user_id: string;
          dispute_type: string;
          affected_event_id?: string | null;
          description: string;
          evidence_notes?: string | null;
        };
        Update: Record<string, never>;
      };
      championship_audit_log: {
        Row: {
          id: string;
          occurred_at: string;
          event_type: string;
          participant_id: string | null;
          user_id: string | null;
          affected_record_id: string | null;
          season_id: string;
          policy_version: string;
          actor: string | null;
          result: string | null;
          reason: string | null;
          metadata: Record<string, unknown> | null;
        };
        Insert: never;
        Update: never;
      };
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
          content: string | null;
          subject_id: string | null;
          created_at: string;
          updated_at: string;
          pdf_url: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string | null;
          subject_id?: string | null;
          created_at?: string;
          updated_at?: string;
          pdf_url?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string | null;
          subject_id?: string | null;
          created_at?: string;
          updated_at?: string;
          pdf_url?: string | null;
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
      trip_registrations: {
        Row: {
          id: string;
          created_at: string;
          full_name: string;
          whatsapp: string;
          mbbs_year: string;
          gender: string;
          emergency_contact: string;
          trip_id: string;
          status: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          full_name: string;
          whatsapp: string;
          mbbs_year: string;
          gender: string;
          emergency_contact: string;
          trip_id?: string;
          status?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          full_name?: string;
          whatsapp?: string;
          mbbs_year?: string;
          gender?: string;
          emergency_contact?: string;
          trip_id?: string;
          status?: string;
        };
      };
      championship_registrations: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          medical_college: string;
          batch: string;
          passport_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          email: string;
          medical_college: string;
          batch: string;
          passport_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          medical_college?: string;
          batch?: string;
          passport_id?: string | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
