import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  combineDateAndTime,
  formatCompetitionDate,
  formatCompetitionTime,
  formatTimeTaken,
  type LiveLeaderboardEntry,
  type PulseStatus,
} from "@/lib/competition-settings-service";
import { toast } from "sonner";
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  ExternalLink,
  Flame,
  Globe,
  GraduationCap,
  HelpCircle,
  Layers,
  Lock,
  Mail,
  Medal,
  Pause,
  Play,
  RotateCcw,
  Scale,
  Search,
  Share2,
  Shield,
  Sparkles,
  Square,
  Trophy,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  BATCH_MAP,
  CHAMPIONSHIP_ALBUM_BADGES,
  DAILY_PULSE_TOTAL,
  EVENT_TZ,
  EVENT_TZ_ABBR,
  EVENT_TZ_OFFSET,
  HALL_OF_FAME_RECORDS,
  SEASON_ID,
  formatIST,
  getDailyPulseTimeState,
  getISTDateString,
  registerChampionshipParticipant,
  submitPulseAttempt,
  submitPulseAttemptAtomic,
  fetchStudentExistingAttempt,
  DEFAULT_PULSE_TIMER_SECONDS,
  type LiveOpsState,
  type PulseSetRecord,
  type PulseAttemptRecord,
  type PassportBadge,
  type PulseQuestion,
  type SeasonStatus,
  type TimeWindowState,
} from "@/lib/championship-service";
import {
  fetchTodayPublishedPulse,
  convertToQuizQuestions,
  fetchLiveOpsState,
} from "@/lib/pulse-admin-service";
import {
  DEFAULT_HALL_OF_FAME,
  type HallOfFameData,
} from "@/lib/super-admin-service";
import { fetchLeaderboardForCurrentPulse, type LeaderboardStudentEntry } from "@/lib/leaderboard-engine";
import { subscribeToPulseLeaderboard } from "@/lib/pulse-service";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import trophyImg from "@/assets/championship-trophy.jpg";
import hoodieImg from "@/assets/championship-hoodie.jpg";

export const Route = createFileRoute("/championship")({
  component: RouteComponent,
});


const RULES = [
  {
    title: "5 Dynamic Pulses Daily (4 MBBS + 1 General)",
    content: "Each 24-hour cycle automatically rotates four questions from 1st and 2nd MBBS subjects (Anatomy, Physiology, Biochemistry, Pathology, Pharmacology, Microbiology, FMT, etc.) plus one General Pulse. Never hardcoded, fully dynamic.",
  },
  {
    title: "Window Schedule: Synchronized Daily Unlocks",
    content: "Pulses unlock promptly at the official scheduled start time configured by the MedTrail Admin. Prior to opening, challenge slots are locked under dynamic countdown.",
  },
  {
    title: "Anti-Cheating Algorithmic Telemetry",
    content: "Server-side submission validation checks response latency, duplicate idempotency keys, and tab telemetry. Unfair tampering triggers immediate disqualification.",
  },
  {
    title: "Official Reward Hierarchy",
    content: "Rank 1 exclusively receives the Physical 24K Gold & Obsidian Trophy. Rank 2 exclusively receives the Limited Edition MedTrail Champion Hoodie. Top 10 receive the Founder Badge and Elite Profile Frame.",
  },
];

function RouteComponent() {
  // Navigation & tabs
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"global" | "college" | "batch" | "weekly">("global");

  // Dynamic Pulse Settings — single source of truth strictly from pulse_settings table
  const [pulseSettings, setPulseSettings] = useState<{
    competition_date: string | null;
    competition_end_date?: string | null;
    start_time: string | null;
    end_time: string | null;
    pulse_status: PulseStatus;
    results_published: boolean;
  }>({
    competition_date: null,
    competition_end_date: null,
    start_time: null,
    end_time: null,
    pulse_status: "upcoming",
    results_published: false,
  });

  const adminPulseStatus = pulseSettings.pulse_status;
  const [dynamicPulseStatus, setDynamicPulseStatus] = useState<PulseStatus>("upcoming");
  const effectivePulseStatus: PulseStatus = dynamicPulseStatus;
  const competitionIsLive = effectivePulseStatus === "live";
  const resultsPublished = pulseSettings.results_published;

  const [currentISTTime, setCurrentISTTime] = useState<string>(() => {
    return new Date().toLocaleTimeString("en-IN", {
      timeZone: EVENT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + " IST";
  });

  const seasonStartUTC = useMemo(
    () => combineDateAndTime(pulseSettings.competition_date, pulseSettings.start_time),
    [pulseSettings.competition_date, pulseSettings.start_time]
  );
  const seasonEndUTC = useMemo(
    () =>
      combineDateAndTime(
        pulseSettings.competition_end_date || pulseSettings.competition_date,
        pulseSettings.end_time
      ),
    [
      pulseSettings.competition_end_date,
      pulseSettings.competition_date,
      pulseSettings.end_time,
    ]
  );
  const seasonStartDisplay = useMemo(
    () => formatCompetitionDate(pulseSettings.competition_date),
    [pulseSettings.competition_date]
  );
  const seasonEndDisplay = useMemo(
    () =>
      formatCompetitionDate(
        pulseSettings.competition_end_date || pulseSettings.competition_date
      ),
    [pulseSettings.competition_end_date, pulseSettings.competition_date]
  );
  const seasonStartTimeDisplay = useMemo(
    () => formatCompetitionTime(pulseSettings.start_time),
    [pulseSettings.start_time]
  );
  const seasonEndTimeDisplay = useMemo(
    () => formatCompetitionTime(pulseSettings.end_time),
    [pulseSettings.end_time]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [myPerformance, setMyPerformance] = useState<LeaderboardStudentEntry | null>(null);
  const [liveElapsed, setLiveElapsed] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0,
    formatted: "00:00:00",
  });

  // Modals & Notifications
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isPassportOpen, setIsPassportOpen] = useState(false);
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);

  // Authentication context
  const { user } = useAuth();

  // Registration state (Requirement 3)
  const [registered, setRegistered] = useState(false);
  const [regName, setRegName] = useState("");
  const [regCollege, setRegCollege] = useState("");
  const [regBatch, setRegBatch] = useState<string>("2026 Batch → Freshers");
  const [regPassportId, setRegPassportId] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [isSubmittingReg, setIsSubmittingReg] = useState(false);
  const [regSuccessMsg, setRegSuccessMsg] = useState("");

  // Pre-fill user profile if authenticated
  useEffect(() => {
    if (user?.email && !regEmail) {
      setRegEmail(user.email);
    }
    if (user?.user_metadata?.full_name && !regName) {
      setRegName(user.user_metadata.full_name);
    }
  }, [user]);

  // Check if current user is already registered in Supabase championship_registrations on load
  useEffect(() => {
    let emailToCheck = user?.email || regEmail;
    if (!emailToCheck) {
      try {
        const saved = localStorage.getItem("medtrail_my_championship_reg");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.email) emailToCheck = parsed.email;
        }
      } catch {}
    }
    if (!emailToCheck) return;

    async function checkServerRegistration() {
      try {
        const { data, error } = await supabase
          .from("championship_registrations")
          .select("*")
          .ilike("email", emailToCheck)
          .maybeSingle();

        if (data && !error) {
          setRegName(data.full_name);
          setRegCollege(data.medical_college);
          setRegBatch(data.batch || "2026 Batch → Freshers");
          setRegPassportId(data.passport_id || "");
          setRegEmail(data.email);
          setRegistered(true);
          setRegSuccessMsg("Registration Confirmed. You're officially participating in MedTrail Championship Season 1.");
        }
      } catch {
        // Ignore network errors on initial check
      }
    }
    checkServerRegistration();
  }, [user?.email, regEmail]);

  // Live Leaderboard Data strictly from championship_pulse_attempts
  const [leaderboard, setLeaderboard] = useState<LiveLeaderboardEntry[]>([]);
  const [collegeRankings, setCollegeRankings] = useState<any[]>([]);
  const [batchRankings, setBatchRankings] = useState<any[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Admin-managed Daily Pulse State
  const [liveOps, setLiveOps] = useState<LiveOpsState | null>(null);

  useEffect(() => {
    async function syncLiveOps() {
      try {
        const ops = await fetchLiveOpsState();
        setLiveOps(ops);
      } catch {}
    }
    syncLiveOps();

    const channel = supabase
      .channel("live_ops_student_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_live_ops" },
        (payload: any) => {
          if (payload?.new) {
            setLiveOps(payload.new as LiveOpsState);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  const [publishedPulseSet, setPublishedPulseSet] = useState<PulseSetRecord | null>(null);
  const [isLoadingPulse] = useState(false);
  const [hasAttemptedToday, setHasAttemptedToday] = useState(false);
  const [todayAttempt, setTodayAttempt] = useState<PulseAttemptRecord | null>(null);
  const [todayQuestions, setTodayQuestions] = useState<PulseQuestion[]>([]);
  const [timeWindowState, setTimeWindowState] = useState<TimeWindowState>({
    status: "before_7pm",
    countdownSeconds: 0,
    label: "Synchronizing Schedule...",
    opensAtIST: "Synchronizing...",
  });

  // Dynamic Hall of Fame (Loaded safely without 404 network queries)
  const [hallOfFame] = useState<HallOfFameData>(() => {
    try {
      const cached = localStorage.getItem("medtrail_hall_of_fame_v1");
      if (cached) return JSON.parse(cached);
    } catch {}
    return DEFAULT_HALL_OF_FAME;
  });

  // Unique identifier for the student (Auth user ID > Email > Guest Persistent Token)
  const getEffectiveStudentId = useCallback(() => {
    if (user?.id) return user.id;
    if (user?.email) return `email:${user.email.toLowerCase()}`;
    if (regEmail.trim()) return `email:${regEmail.trim().toLowerCase()}`;
    if (typeof window === "undefined") return "guest_server";
    let guestId = localStorage.getItem("medtrail_pulse_guest_id");
    if (!guestId) {
      guestId = "guest_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem("medtrail_pulse_guest_id", guestId);
    }
    return guestId;
  }, [user, regEmail]);

  // Quiz execution state
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [quizResult, setQuizResult] = useState<{ score: number; accuracy: number; xp: number } | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [hasSubmittedAnswer, setHasSubmittedAnswer] = useState(false);

  // Pulse Countdown Timer (Configurable 60s per pulse) - Declared after quiz state to prevent TDZ ReferenceErrors
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(DEFAULT_PULSE_TIMER_SECONDS);
  const selectedOptionRef = useRef<number | null>(null);
  const currentQIndexRef = useRef<number>(0);
  const hasSubmittedAnswerRef = useRef<boolean>(false);
  const isQuizOpenRef = useRef<boolean>(false);
  const handleSubmitQuestionRef = useRef<(autoOption?: number | null) => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    selectedOptionRef.current = selectedOption;
  }, [selectedOption]);

  useEffect(() => {
    currentQIndexRef.current = currentQIndex;
  }, [currentQIndex]);

  useEffect(() => {
    hasSubmittedAnswerRef.current = hasSubmittedAnswer;
  }, [hasSubmittedAnswer]);

  useEffect(() => {
    isQuizOpenRef.current = isQuizOpen;
  }, [isQuizOpen]);

  // Overall Season countdown & launch state (Requirement 4 & 5)
  const [seasonRemaining, setSeasonRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    status: "pre" as SeasonStatus,
    isLive: false,
    label: "LIVE PULSE BEGINS",
  });

  // Load existing registration from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("medtrail_my_championship_reg");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fullName) {
          setRegName(parsed.fullName);
          setRegCollege(parsed.medicalCollege || "");
          setRegBatch(parsed.batch || "2026 Batch → Freshers");
          setRegPassportId(parsed.passportId || "");
          setRegEmail(parsed.email || "");
          setRegistered(true);
          setRegSuccessMsg("Registration Confirmed. You're officially participating in MedTrail Championship Season 1.");
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  // Default Pulse questions (4 MBBS + 1 General)
  const DEFAULT_PULSE_QUESTIONS: PulseQuestion[] = useMemo(() => [
    {
      id: "pulse-default-1",
      slot: 1,
      subject: "Anatomy",
      category: "1st MBBS",
      question: "Which nerve is most vulnerable to injury in fractures of the humeral shaft at the radial groove?",
      options: ["Radial nerve", "Median nerve", "Ulnar nerve", "Axillary nerve"],
      correctIndex: 0,
      explanation: "The radial nerve runs directly in the spiral (radial) groove on the posterior surface of the humerus and is most commonly injured in mid-shaft fractures, causing wrist drop.",
      xp: 50,
      points: 50,
      time_limit_seconds: 60,
    },
    {
      id: "pulse-default-2",
      slot: 2,
      subject: "Physiology",
      category: "1st MBBS",
      question: "What is the primary site of erythropoietin production in healthy adults?",
      options: ["Renal peritubular interstitial cells", "Hepatic hepatocytes", "Splenic red pulp", "Bone marrow stroma"],
      correctIndex: 0,
      explanation: "In healthy adults, approximately 85-90% of erythropoietin is produced by interstitial cells in the peritubular capillary bed of the renal cortex in response to hypoxia.",
      xp: 50,
      points: 50,
      time_limit_seconds: 60,
    },
    {
      id: "pulse-default-3",
      slot: 3,
      subject: "Biochemistry",
      category: "1st MBBS",
      question: "Which enzyme catalyzes the rate-limiting and committed step of glycolysis?",
      options: ["Phosphofructokinase-1 (PFK-1)", "Hexokinase", "Pyruvate kinase", "Aldolase"],
      correctIndex: 0,
      explanation: "Phosphofructokinase-1 (PFK-1) converts fructose-6-phosphate to fructose-1,6-bisphosphate and serves as the key rate-limiting regulatory enzyme in glycolysis.",
      xp: 50,
      points: 50,
      time_limit_seconds: 60,
    },
    {
      id: "pulse-default-4",
      slot: 4,
      subject: "Pathology",
      category: "2nd MBBS",
      question: "Which of the following is the characteristic histopathological hallmark of caseous necrosis?",
      options: [
        "Structureless, amorphous granular debris surrounded by a granulomatous rim",
        "Ghost cell outlines with preserved tissue architecture",
        "Enzymatic digestion yielding liquid viscous mass",
        "Focal fat destruction with saponification",
      ],
      correctIndex: 0,
      explanation: "Caseous necrosis (classically seen in tuberculosis) appears as friable, cheese-like debris microscopically composed of amorphous granular debris surrounded by epithelioid histiocytes and Langhans giant cells.",
      xp: 50,
      points: 50,
      time_limit_seconds: 60,
    },
    {
      id: "pulse-default-5",
      slot: 5,
      subject: "General",
      category: "General Pulse",
      question: "In standard clinical medical ethics, which principle emphasizes the physician's obligation to do no harm ('primum non nocere')?",
      options: ["Non-maleficence", "Beneficence", "Autonomy", "Distributive Justice"],
      correctIndex: 0,
      explanation: "Non-maleficence requires clinicians to avoid inflicting harm on patients, historically summarized as 'primum non nocere' (first, do no harm).",
      xp: 50,
      points: 50,
      time_limit_seconds: 60,
    },
  ], []);

  // Load today's questions and student's attempt safely from Supabase championship_pulse_sets
  const loadTodayPulse = useCallback(async () => {
    try {
      const targetDate = pulseSettings.competition_date || getISTDateString();
      let questionsToUse: PulseQuestion[] = [];
      let setRecord: PulseSetRecord | null = null;

      // 1. Fetch official Admin-published pulse from Supabase (championship_pulse_sets)
      try {
        const publishedPulse = await fetchTodayPublishedPulse(targetDate);
        if (publishedPulse && Array.isArray(publishedPulse.questions) && publishedPulse.questions.length > 0) {
          const converted = convertToQuizQuestions(publishedPulse.questions);
          if (converted.length > 0) {
            questionsToUse = converted;
            setRecord = publishedPulse;
          }
        }
      } catch (fetchErr) {
        console.warn("[Student Pulse] Supabase published pulse fetch notice:", fetchErr);
      }

      // 2. Check localStorage cache if network fetch returned nothing (offline / fallback)
      if (questionsToUse.length === 0) {
        try {
          const raw = localStorage.getItem("medtrail_admin_pulse_sets_v2");
          if (raw) {
            const sets = JSON.parse(raw);
            const found = sets[targetDate] || sets[getISTDateString()];
            if (found && found.status === "published" && Array.isArray(found.questions) && found.questions.length > 0) {
              setRecord = found;
              questionsToUse = convertToQuizQuestions(found.questions);
            }
          }
        } catch {}
      }

      // 3. Fallback only if genuinely no published pulse exists
      if (questionsToUse.length === 0) {
        questionsToUse = DEFAULT_PULSE_QUESTIONS;
        setRecord = {
          id: `pulse-default-${targetDate}`,
          pulse_date: targetDate,
          status: "published",
          questions: questionsToUse as any,
          published_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }

      setPublishedPulseSet(setRecord);
      setTodayQuestions(questionsToUse);

      // Check student's single daily attempt in Supabase (Enforce One Attempt Only)
      const studentId = getEffectiveStudentId();
      if (studentId || user?.id || user?.email || regEmail) {
        try {
          const remoteCheck = await fetchStudentExistingAttempt({
            userId: user?.id || studentId,
            userEmail: user?.email || regEmail,
            pulseId: setRecord?.id,
            pulseDate: targetDate,
          });

          if (remoteCheck.hasSubmitted && remoteCheck.attempt) {
            const attempt = remoteCheck.attempt;
            setHasAttemptedToday(true);
            setTodayAttempt(attempt);
            if (attempt.answers && Array.isArray(attempt.answers)) {
              setUserAnswers(attempt.answers);
            }
            setQuizResult({
              score: Number(attempt.score ?? 0),
              accuracy: Number(attempt.accuracy ?? 0),
              xp: Number(attempt.xp ?? attempt.xp_earned ?? 0),
            });
          } else {
            // Local fallback check
            const rawAttempts = localStorage.getItem("medtrail_pulse_attempts_v2");
            if (rawAttempts) {
              const attempts = JSON.parse(rawAttempts);
              const key = `${targetDate}_${studentId}`;
              const attempt = attempts[key] || attempts[`${getISTDateString()}_${studentId}`];
              if (attempt) {
                setHasAttemptedToday(true);
                setTodayAttempt(attempt);
                if (attempt.answers && Array.isArray(attempt.answers)) {
                  setUserAnswers(attempt.answers);
                }
                setQuizResult({
                  score: Number(attempt.score ?? 0),
                  accuracy: Number(attempt.accuracy ?? 0),
                  xp: Number(attempt.xp ?? attempt.xp_earned ?? 0),
                });
              } else {
                setHasAttemptedToday(false);
                setTodayAttempt(null);
              }
            } else {
              setHasAttemptedToday(false);
              setTodayAttempt(null);
            }
          }
        } catch (checkErr) {
          console.warn("[Student Pulse] Check attempt error:", checkErr);
        }
      }
    } catch (err) {
      console.warn("[Student Pulse] loadTodayPulse warning:", err);
    }
  }, [pulseSettings.competition_date, getEffectiveStudentId, DEFAULT_PULSE_QUESTIONS, user?.id, user?.email, regEmail]);

  // Load pulse questions on mount
  useEffect(() => {
    loadTodayPulse();
  }, [loadTodayPulse]);

  // 1 & 2. Supabase Realtime Subscription on pulse_settings table (Single Source of Truth)
  useEffect(() => {
    let isMounted = true;

    // Initial fetch from pulse_settings
    async function initPulseSettings() {
      try {
        const { data, error } = await supabase
          .from("pulse_settings")
          .select("competition_date, competition_end_date, start_time, end_time, pulse_status, results_published")
          .limit(1)
          .maybeSingle();

        if (isMounted && !error && data) {
          setPulseSettings({
            competition_date: data.competition_date ?? null,
            competition_end_date: (data as any).competition_end_date ?? null,
            start_time: data.start_time ?? null,
            end_time: data.end_time ?? null,
            pulse_status: (data.pulse_status as PulseStatus) || "upcoming",
            results_published: Boolean(data.results_published),
          });
        }
      } catch (err) {
        console.warn("[Student Pulse] Initial fetch warning:", err);
      }
    }

    initPulseSettings();

    // 2. Subscribe to "pulse_settings" using Supabase Realtime ("postgres_changes" on UPDATE)
    const channel = supabase
      .channel("student_pulse_realtime_sync")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pulse_settings",
        },
        (payload: any) => {
          // 3. On receiving an UPDATE, immediately refresh the local pulse state
          if (payload?.new && isMounted) {
            const row = payload.new;
            setPulseSettings({
              competition_date: row.competition_date ?? null,
              competition_end_date: row.competition_end_date ?? null,
              start_time: row.start_time ?? null,
              end_time: row.end_time ?? null,
              pulse_status: (row.pulse_status as PulseStatus) || "upcoming",
              results_published: Boolean(row.results_published),
            });
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn("[Student Pulse] Realtime subscription status:", status, err);
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Synchronized dynamic leaderboard loaded strictly from championship_pulse_attempts
  const loadLeaderboard = useCallback(async () => {
    setLoadingLeaderboard(true);
    try {
      const studentId = getEffectiveStudentId();
      const res = await fetchLeaderboardForCurrentPulse({
        pulseSetId: publishedPulseSet?.id,
        pulseDate: pulseSettings.competition_date,
        currentUserEmail: user?.email || regEmail,
        currentUserId: user?.id || studentId,
        participantId: studentId,
        isAdmin: false, // Student Public view strictly receives Top 5
      });

      // Requirement 1 & 5: Public leaderboard contains only Top 5
      setLeaderboard(res.entries.slice(0, 5));
      // Requirement 2: Private personal rank card data for the logged-in student
      setMyPerformance(res.currentUserEntry || null);
      setCollegeRankings(res.collegeRankings);
      setBatchRankings(res.batchRankings);
    } catch (err) {
      console.warn("[Student Leaderboard] load warning:", err);
    } finally {
      setLoadingLeaderboard(false);
    }
  }, [publishedPulseSet?.id, pulseSettings.competition_date, user?.email, user?.id, regEmail, getEffectiveStudentId]);

  useEffect(() => {
    loadLeaderboard();

    // Real-time subscription to championship_pulse_attempts updates
    const unsubscribe = subscribeToPulseLeaderboard(() => {
      loadLeaderboard();
    });

    return () => {
      unsubscribe();
    };
  }, [loadLeaderboard]);

  // Watch dynamic synchronized countdown and current IST clock every second
  useEffect(() => {
    const updateTimeState = () => {
      const now = new Date();
      const start = seasonStartUTC;
      const end = seasonEndUTC;

      // Dynamic Live IST Clock updating every second
      const formattedIST =
        now.toLocaleTimeString("en-IN", {
          timeZone: EVENT_TZ,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " IST";
      setCurrentISTTime(formattedIST);

      // Dynamic automatic status transition without refresh: Upcoming → LIVE → ENDED
      let currentStatus: PulseStatus = "upcoming";
      if (adminPulseStatus === "paused") {
        currentStatus = "paused";
      } else if (adminPulseStatus === "ended") {
        currentStatus = "ended";
      } else if (end && now.getTime() >= end.getTime()) {
        currentStatus = "ended";
      } else if (adminPulseStatus === "live" || (start && now.getTime() >= start.getTime())) {
        currentStatus = "live";
      } else {
        currentStatus = "upcoming";
      }

      setDynamicPulseStatus(currentStatus);

      if (currentStatus === "live") {
        // 1. Elapsed time during LIVE (counting up since start)
        const elapsedMs = start ? Math.max(0, now.getTime() - start.getTime()) : 0;
        const elHours = Math.floor(elapsedMs / (1000 * 60 * 60));
        const elMinutes = Math.floor((elapsedMs / (1000 * 60)) % 60);
        const elSeconds = Math.floor((elapsedMs / 1000) % 60);
        setLiveElapsed({
          hours: elHours,
          minutes: elMinutes,
          seconds: elSeconds,
          formatted: `${String(elHours).padStart(2, "0")}:${String(elMinutes).padStart(2, "0")}:${String(elSeconds).padStart(2, "0")}`,
        });

        // 2. Concludes in (counting down until end)
        const diff = end ? Math.max(0, end.getTime() - now.getTime()) : 0;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);

        setTimeWindowState({
          status: "active_pulse",
          countdownSeconds: Math.floor(diff / 1000),
          label: "Pulse Active & Live Now",
          opensAtIST: "LIVE NOW",
        });

        setSeasonRemaining({
          days,
          hours,
          minutes,
          seconds,
          status: "live",
          isLive: true,
          label: "Pulse Concludes In",
        });
        return;
      }

      if (currentStatus === "paused") {
        setTimeWindowState({
          status: "before_7pm",
          countdownSeconds: 0,
          label: "Pulse Paused by Admin",
          opensAtIST: "PAUSED",
        });
        setSeasonRemaining({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          status: "pre",
          isLive: false,
          label: "PULSE PAUSED",
        });
        return;
      }

      if (currentStatus === "ended") {
        setTimeWindowState({
          status: "day_ended",
          countdownSeconds: 0,
          label: "Today's Pulse Ended",
          opensAtIST: "ENDED",
        });
        setSeasonRemaining({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          status: "ended",
          isLive: false,
          label: "Pulse Ended",
        });
        return;
      }

      // Default: "upcoming"
      if (start) {
        const diff = Math.max(0, start.getTime() - now.getTime());
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);

        setTimeWindowState({
          status: "before_7pm",
          countdownSeconds: Math.floor(diff / 1000),
          label: "Live Pulse Begins In",
          opensAtIST: seasonStartTimeDisplay || "Scheduled Window",
        });
        setSeasonRemaining({
          days,
          hours,
          minutes,
          seconds,
          status: "pre",
          isLive: false,
          label: "LIVE PULSE BEGINS",
        });
      } else {
        setTimeWindowState({
          status: "before_7pm",
          countdownSeconds: 0,
          label: "Live Pulse Schedule TBA",
          opensAtIST: "TBA",
        });
        setSeasonRemaining({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          status: "pre",
          isLive: false,
          label: "LIVE PULSE BEGINS",
        });
      }
    };

    updateTimeState();
    const interval = setInterval(updateTimeState, 1000);
    return () => clearInterval(interval);
  }, [adminPulseStatus, seasonStartUTC, seasonEndUTC, seasonStartTimeDisplay]);

  // Filter public leaderboard (strictly limited to Top 5)
  const filteredLeaderboard = useMemo(() => {
    const top5 = leaderboard.slice(0, 5);
    if (!searchQuery.trim()) return top5;
    const q = searchQuery.toLowerCase();
    return top5.filter(
      (p) =>
        (p.display_name && p.display_name.toLowerCase().includes(q)) ||
        (p.institution && p.institution.toLowerCase().includes(q))
    );
  }, [leaderboard, searchQuery]);

  // Handle registration submission (Connect to public.championship_registrations)
  const handleRegisterSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Requirement 1: Registration Lock check
    if (liveOps && liveOps.registration_open === false) {
      toast.error("Registration is currently closed by Administration. No new registrations are being accepted.");
      return;
    }

    const effectiveEmail = (user?.email && user.email.trim()) ? user.email.trim() : regEmail.trim();
    if (!regName.trim() || !regCollege.trim() || !effectiveEmail) {
      toast.error("Please fill in all required fields: Full Name, Medical College, and Email.");
      return;
    }

    setIsSubmittingReg(true);
    try {
      const result = await registerChampionshipParticipant({
        fullName: regName.trim(),
        medicalCollege: regCollege.trim(),
        batch: regBatch,
        passportId: regPassportId.trim() || undefined,
        email: effectiveEmail,
      });

      // Prevent duplicate registration using the same email
      if (result.alreadyRegistered) {
        toast.error("This email is already registered for Season 1.");
        if (result.passportId || result.data?.passport_id) {
          setRegPassportId(result.passportId || result.data.passport_id);
        }
        setRegistered(true);
        setRegSuccessMsg("Registration Confirmed. You're officially participating in MedTrail Championship Season 1.");
        setIsRegisterOpen(false);
        navigate({ to: "/championship" });
        setTimeout(() => {
          const el = document.getElementById("registration");
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }, 150);
        return;
      }

      if (!result.success) {
        if (result.requiresAuth) {
          toast.error(result.message);
          navigate({ to: "/login" });
          return;
        }
        toast.error(result.message || "Registration failed. Please try again.");
        return;
      }

      // After successful insert:
      const confirmedPassportId = result.passportId || result.data?.passport_id || regPassportId;
      setRegPassportId(confirmedPassportId);
      setRegistered(true);
      setRegSuccessMsg("Registration Confirmed. You're officially participating in MedTrail Championship Season 1.");
      setIsRegisterOpen(false);
      toast.success("Registration Confirmed! You're officially participating in MedTrail Championship Season 1.");

      navigate({ to: "/championship" });
      setTimeout(() => {
        const el = document.getElementById("registration");
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        }
      }, 150);
    } catch (err: any) {
      console.error("Registration submission error:", err);
      toast.error(err?.message || "Registration failed. Please check your network and try again.");
    } finally {
      setIsSubmittingReg(false);
    }
  };

  // Start Pulse Quiz (Strict Admin-managed single attempt per day)
  const startPulseQuiz = () => {
    // Requirement 9: pulse_status alone controls whether submissions are open or closed
    // Requirement 8: results_published controls visibility only
    if (adminPulseStatus === "paused") {
      toast.warning("Pulse is currently paused by Administration. Submissions on hold.");
      return;
    }
    if (adminPulseStatus === "ended") {
      toast.info("Today's Pulse session has concluded.");
      return;
    }
    if (adminPulseStatus !== "live") {
      toast.info(
        `Today's Pulse opens at ${seasonStartTimeDisplay || "scheduled start time"}. Countdown is in progress.`
      );
      return;
    }

    // 1. Must be published by Admin in Supabase
    if (!publishedPulseSet || todayQuestions.length === 0) {
      toast.info(
        `Today's Pulse questions are being prepared by the MedTrail Admin. They will unlock shortly.`
      );
      return;
    }

    // 2. Students can only attempt once per day
    if (hasAttemptedToday) {
      toast.info("You have already completed today's official Pulse attempt! Loading faculty explanations...");
      setIsReviewModalOpen(true);
      return;
    }

    const initialLimit = todayQuestions[0]?.time_limit_seconds || DEFAULT_PULSE_TIMER_SECONDS;
    setTimerSecondsLeft(initialLimit);
    setCurrentQIndex(0);
    setUserAnswers([]);
    setQuizFinished(false);
    setQuizResult(null);
    setSelectedOption(null);
    setHasSubmittedAnswer(false);
    setQuizStartTime(Date.now());
    setIsQuizOpen(true);
  };

  const handleSelectOption = (idx: number) => {
    if (hasSubmittedAnswerRef.current || hasAttemptedToday) return;
    setSelectedOption(idx);
  };

  const handleSubmitQuestion = async (autoOption?: number | null) => {
    if (hasAttemptedToday) {
      toast.error("You have already submitted this Pulse. Only 1 attempt is permitted.");
      return;
    }
    if (adminPulseStatus === "paused") {
      toast.warning("Pulse is currently paused by Administration. Submissions on hold.");
      return;
    }
    if (adminPulseStatus === "ended") {
      toast.info("Today's Pulse session has concluded.");
      return;
    }
    if (adminPulseStatus !== "live") {
      toast.info("Today's Pulse session is not live. Submissions are closed.");
      return;
    }

    if (hasSubmittedAnswerRef.current) return;

    // Determine final choice (autoOption on timeout or manual selectedOption)
    const finalChoice = autoOption !== undefined ? autoOption : selectedOption;
    if (finalChoice === null && autoOption === undefined) return;

    // -1 denotes timed out / unanswered question
    const answerToRecord = finalChoice !== null && finalChoice !== undefined ? finalChoice : -1;
    hasSubmittedAnswerRef.current = true;
    setHasSubmittedAnswer(true);

    if (answerToRecord === -1) {
      toast.warning(`Time expired on Pulse Slot ${currentQIndex + 1}! Advancing...`, { duration: 2500 });
    }

    const newAnswers = [...userAnswers, answerToRecord];
    setUserAnswers(newAnswers);

    const isLast = currentQIndex === todayQuestions.length - 1;

    setTimeout(async () => {
      if (isLast) {
        let correctCount = 0;
        let earnedScore = 0;
        let earnedXP = 0;

        todayQuestions.forEach((q, i) => {
          if (newAnswers[i] === q.correctIndex) {
            correctCount++;
            earnedScore += q.points;
            earnedXP += q.xp;
          }
        });

        const accuracy = Math.round((correctCount / todayQuestions.length) * 100);
        const timeTaken = Math.round((Date.now() - quizStartTime) / 1000);
        const todayStr = publishedPulseSet?.pulse_date || getISTDateString();
        const studentId = getEffectiveStudentId();
        const effectiveUserId = user?.id || studentId;
        const pulseId = publishedPulseSet?.id || `pulse_${todayStr}`;
        const studentEmail = user?.email || regEmail || null;
        const studentName = regName || user?.user_metadata?.full_name || "Doctor";
        const studentCollege = regCollege || "Medical College";
        const studentBatch = regBatch || "2026 Batch → Freshers";

        // Atomic submission to Supabase: enforces One Attempt Only & triggers standings recalculation
        const atomicRes = await submitPulseAttemptAtomic({
          pulseId,
          pulseDate: todayStr,
          userId: effectiveUserId,
          userEmail: studentEmail,
          studentName,
          college: studentCollege,
          batch: studentBatch,
          answers: newAnswers,
          questions: todayQuestions,
          timeTakenSeconds: timeTaken,
        });

        setHasAttemptedToday(true);
        setQuizFinished(true);

        const finalScore = atomicRes.score ?? earnedScore;
        const finalAccuracy = atomicRes.accuracy ?? accuracy;
        const finalXP = atomicRes.xp ?? earnedXP;

        setQuizResult({
          score: finalScore,
          accuracy: finalAccuracy,
          xp: finalXP,
        });

        if (atomicRes.alreadySubmitted) {
          toast.error("You have already submitted this Pulse. Only 1 attempt is permitted.");
        } else {
          toast.success("Pulse submitted successfully! Leaderboard & standings updated.");
        }

        // Cache attempt record locally for instant UI restoration across reloads
        try {
          const attemptRecord: PulseAttemptRecord = {
            id: atomicRes.attemptId || `att-${todayStr}-${studentId}`,
            pulse_set_id: pulseId,
            pulse_date: todayStr,
            user_id: effectiveUserId,
            user_email: studentEmail || undefined,
            participant_id: studentId,
            score: finalScore,
            accuracy: finalAccuracy,
            xp: finalXP,
            time_taken_seconds: timeTaken,
            answers: newAnswers,
            completed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          };
          const rawAttempts = localStorage.getItem("medtrail_pulse_attempts_v2");
          const localAttempts = JSON.parse(rawAttempts || "{}");
          const key = `${todayStr}_${studentId}`;
          localAttempts[key] = attemptRecord;
          localStorage.setItem("medtrail_pulse_attempts_v2", JSON.stringify(localAttempts));
          setTodayAttempt(attemptRecord);
        } catch (e) {
          console.error("Failed to record student pulse attempt locally:", e);
        }

        // Also notify client pulse service state
        await submitPulseAttempt({
          slot: 1,
          answers: newAnswers,
          questions: todayQuestions,
          timeTakenSeconds: timeTaken,
        });

        // Immediately refetch leaderboard & standings
        await loadLeaderboard();
      } else {
        setCurrentQIndex((prev) => prev + 1);
        setSelectedOption(null);
        setHasSubmittedAnswer(false);
        hasSubmittedAnswerRef.current = false;
      }
    }, 1100);
  };

  useEffect(() => {
    handleSubmitQuestionRef.current = handleSubmitQuestion;
  });

  // Reset timer on question switch or when quiz opens
  useEffect(() => {
    if (!isQuizOpen || quizFinished) return;
    const limit = todayQuestions[currentQIndex]?.time_limit_seconds || DEFAULT_PULSE_TIMER_SECONDS;
    setTimerSecondsLeft(limit);
  }, [currentQIndex, isQuizOpen, quizFinished, todayQuestions]);

  // Pulse Countdown Timer interval (Counts down 1 second at a time; auto-submits on 0)
  useEffect(() => {
    if (!isQuizOpen || quizFinished || hasSubmittedAnswer) return;
    if (adminPulseStatus === "paused") return;

    const interval = setInterval(() => {
      setTimerSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmitQuestionRef.current(selectedOptionRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isQuizOpen, quizFinished, hasSubmittedAnswer, adminPulseStatus, currentQIndex]);

  const handleShare = () => {
    if (navigator.share) {
      navigator
        .share({
          title: "MedTrail Championship Season 1",
          text: "Join me in the MedTrail Season 1 Championship! Rise Through Every Pulse.",
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 3000);
    }
  };

  const formatCountdown = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 relative overflow-x-hidden selection:bg-blue-600 selection:text-white">
      {/* Dynamic Background Mesh & Glowing Ambient Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/15 rounded-full blur-[140px] animate-pulse" />
        <div className="absolute top-1/4 -right-40 w-[30rem] h-[30rem] bg-indigo-600/15 rounded-full blur-[160px]" />
        <div className="absolute top-2/3 left-1/3 w-80 h-80 bg-amber-500/10 rounded-full blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:28px_28px] opacity-25" />
      </div>

      {/* Share Toast */}
      {showShareToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-900/95 border border-blue-500/40 text-blue-200 text-sm shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Championship invite URL copied to clipboard!</span>
        </div>
      )}

      {/* Sticky Quick Nav Bar */}
      <nav className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-xs font-semibold tracking-wide uppercase"
          >
            <span>&larr; Back</span>
          </Link>
          <div className="h-4 w-px bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-extrabold text-sm tracking-wider flex items-center gap-1.5">
              <Trophy className="w-4 h-4" /> MEDTRAIL
            </span>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono text-[10px] font-bold uppercase border border-blue-500/30">
              CHAMPIONSHIP S1
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsPassportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 transition-all cursor-pointer shadow-sm"
          >
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Founder</span> Badges
          </button>

          <button
            onClick={handleShare}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="Share Championship"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>

          {registered ? (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Enrolled</span>
            </div>
          ) : (
            <button
              onClick={() => {
                const el = document.getElementById("registration");
                if (el) el.scrollIntoView({ behavior: "smooth" });
                else setIsRegisterOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 hover:shadow-blue-500/50 transition cursor-pointer"
            >
              <span>Register</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </nav>

      {/* Main Container */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12 sm:space-y-16">

        {/* HERO SECTION — EXACT 3D TROPHY PRESERVED */}
        <section className="relative rounded-3xl border border-slate-800/80 bg-gradient-to-b from-slate-900/90 via-[#0B132B]/80 to-[#070B14]/90 p-6 sm:p-10 lg:p-14 overflow-hidden shadow-2xl backdrop-blur-xl">
          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            
            <div className="lg:col-span-7 space-y-6 text-left">
              
              {/* Requirement 5: Registration Status Badge */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold tracking-wider uppercase shadow-inner">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  SEASON 1
                </span>

                {/* Status badge — driven by dynamic status (auto-computed + admin override) */}
                {effectivePulseStatus === "live" ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-black tracking-wider uppercase shadow-lg shadow-red-500/20 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    🔴 CHAMPIONSHIP LIVE
                  </span>
                ) : effectivePulseStatus === "ended" ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-slate-700/60 border border-slate-600 text-slate-300 text-xs font-black tracking-wider uppercase">
                    🏁 SEASON ENDED
                  </span>
                ) : effectivePulseStatus === "paused" ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-black tracking-wider uppercase">
                    ⏸️ PULSE PAUSED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-black tracking-wider uppercase shadow-lg shadow-emerald-500/20">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    🟢 UPCOMING / REGISTRATION OPEN
                  </span>
                )}

                {/* Dynamic Live IST Clock */}
                <span className="text-xs text-slate-300 flex items-center gap-1.5 font-mono px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/60">
                  <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                  <span className="text-amber-300 font-bold">{currentISTTime}</span>
                  <span className="text-slate-400 hidden sm:inline">&bull; Asia/Kolkata (IST)</span>
                </span>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.1]">
                  MEDTRAIL <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-amber-200 bg-clip-text text-transparent">CHAMPIONSHIP</span>
                </h1>
                <p className="text-lg sm:text-xl font-medium text-blue-200/90 tracking-wide">
                  Rise Through Every Pulse &bull; <span className="text-slate-400">Discover. Compete. Become.</span>
                </p>
              </div>

              {/* Dynamic hero timer block — automatically switches: Upcoming → LIVE → ENDED */}
              {effectivePulseStatus === "upcoming" ? (
                /* BEFORE LAUNCH: Show countdown & prominent header */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/70 via-slate-900/80 to-indigo-950/70 border border-blue-500/30 backdrop-blur-md shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-500/20 pb-3">
                    <div>
                      <div className="text-xs font-mono font-black tracking-widest text-blue-400 uppercase">
                        OFFICIAL COMPETITION LAUNCH
                      </div>
                      <div className="text-2xl sm:text-3xl font-black text-white tracking-wide flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
                        LIVE PULSE BEGINS IN
                      </div>
                    </div>
                    <div className="sm:text-right font-mono">
                      <div className="text-base font-extrabold text-amber-300">
                        {seasonStartDisplay ?? "Date to be announced"}
                      </div>
                      <div className="text-xs font-semibold text-slate-300">
                        {seasonStartUTC ? (seasonStartTimeDisplay ?? "") : ""}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Registration Open &bull; Enrolling Batches 2023–2026
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">Asia/Kolkata (IST, UTC+5:30)</span>
                  </div>

                  {/* Countdown Timer — only show if date is configured */}
                  {seasonStartUTC ? (
                    <div className="grid grid-cols-4 gap-2 sm:gap-3 max-w-md pt-1">
                      {[
                        { label: "DAYS", val: seasonRemaining.days },
                        { label: "HOURS", val: seasonRemaining.hours },
                        { label: "MINS", val: seasonRemaining.minutes },
                        { label: "SECS", val: seasonRemaining.seconds },
                      ].map((unit, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/90 border border-blue-500/20 shadow-inner"
                        >
                          <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                            {String(unit.val).padStart(2, "0")}
                          </span>
                          <span className="text-[10px] font-semibold text-blue-300/80 tracking-widest mt-0.5">
                            {unit.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pt-2">
                      <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-300 text-sm font-semibold">
                        <Calendar className="w-4 h-4 text-amber-400" />
                        Competition date will be announced.
                      </div>
                    </div>
                  )}
                </div>
              ) : effectivePulseStatus === "live" ? (
                /* LIVE: Real-time Elapsed Time & Concludes In */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-red-950/70 via-slate-900/90 to-amber-950/50 border border-red-500/50 backdrop-blur-md shadow-2xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-red-500/20 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                      <span className="text-xs font-mono font-black text-red-400 uppercase tracking-wider">
                        CHAMPIONSHIP PULSE IS LIVE
                      </span>
                    </div>
                    <div className="sm:text-right font-mono text-xs text-slate-300">
                      <span className="text-slate-400">Ends at: </span>
                      <strong className="text-amber-300 font-bold">
                        {seasonEndTimeDisplay || "Official Session Close"}
                      </strong>
                      <span className="text-slate-400 text-[11px] block sm:inline sm:ml-1">
                        ({seasonEndDisplay || "Today"}, Asia/Kolkata)
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-2xl font-black text-white">Daily Pulses Are Now Active</h3>
                    <p className="text-sm text-slate-300 mt-1">
                      The competition is live! Complete your daily 5 challenges (4 MBBS + 1 General) to claim points, elevate your college, and win the 24K Gold &amp; Obsidian Trophy.
                    </p>
                  </div>

                  {/* Real-time Tickers: Elapsed Time + Time Remaining */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 max-w-lg pt-1">
                    <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/90 border border-red-500/30 shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-widest">
                        ELAPSED HRS
                      </span>
                      <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                        {String(liveElapsed.hours).padStart(2, "0")}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400 tracking-widest mt-0.5">
                        HOURS
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/90 border border-red-500/30 shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-widest">
                        ELAPSED MIN
                      </span>
                      <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                        {String(liveElapsed.minutes).padStart(2, "0")}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400 tracking-widest mt-0.5">
                        MINUTES
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/90 border border-red-500/30 shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-widest">
                        ELAPSED SEC
                      </span>
                      <span className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono tracking-tight">
                        {String(liveElapsed.seconds).padStart(2, "0")}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400 tracking-widest mt-0.5">
                        SECONDS
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/90 border border-amber-500/30 shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-widest">
                        REMAINING
                      </span>
                      <span className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono tracking-tight">
                        {String(seasonRemaining.minutes).padStart(2, "0")}:{String(seasonRemaining.seconds).padStart(2, "0")}
                      </span>
                      <span className="text-[9px] font-semibold text-amber-400/80 tracking-widest mt-0.5">
                        MIN : SEC
                      </span>
                    </div>
                  </div>
                </div>
              ) : effectivePulseStatus === "ended" ? (
                /* ENDED: Dedicated ended state */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-700/60 backdrop-blur-md shadow-xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                      <span className="text-xs font-mono font-black text-slate-300 uppercase tracking-wider">
                        CHAMPIONSHIP PULSE CONCLUDED
                      </span>
                    </div>
                    <span className="text-xs font-mono text-amber-400 font-semibold">
                      Session Closed &bull; {seasonEndTimeDisplay || "Official Window End"} IST
                    </span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">Today's Pulse Has Ended</h3>
                    <p className="text-sm text-slate-300 mt-1">
                      Submissions for today's championship pulse are now closed. All student attempts have been verified and securely recorded in Supabase. Check the Leaderboard below for current standings.
                    </p>
                  </div>
                </div>
              ) : (
                /* PAUSED */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-950/50 via-slate-900 to-amber-950/30 border border-amber-500/40 backdrop-blur-md shadow-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-xs font-mono font-black text-amber-300 uppercase tracking-wider">
                      CHAMPIONSHIP PULSE PAUSED
                    </span>
                  </div>
                  <h3 className="text-2xl font-black text-white">Pulse Paused by Administrator</h3>
                  <p className="text-sm text-slate-300">
                    The competition pulse is temporarily paused. Real-time standings will resume shortly.
                  </p>
                </div>
              )}

              {/* Action Buttons: Join Pulse becomes active at start time */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                {hasAttemptedToday ? (
                  <button
                    onClick={() => setIsReviewModalOpen(true)}
                    className="relative group inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-sm tracking-wider uppercase shadow-xl shadow-emerald-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <BookOpen className="w-5 h-5 text-emerald-100" />
                    <span>VIEW EXPLANATIONS & RESULTS</span>
                    <Sparkles className="w-4 h-4 text-emerald-200 group-hover:rotate-12 transition-transform" />
                  </button>
                ) : effectivePulseStatus === "live" ? (
                  <button
                    onClick={startPulseQuiz}
                    className="relative group inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-rose-500 text-white font-black text-sm tracking-wider uppercase shadow-xl shadow-red-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-white animate-pulse" />
                    <span>JOIN PULSE NOW</span>
                    <Sparkles className="w-4 h-4 text-amber-200 group-hover:rotate-12 transition-transform" />
                  </button>
                ) : effectivePulseStatus === "paused" ? (
                  <button
                    onClick={startPulseQuiz}
                    className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-amber-950/40 text-amber-300 border border-amber-500/40 font-bold text-sm cursor-pointer"
                  >
                    <Pause className="w-4 h-4 text-amber-400" />
                    <span>PULSE PAUSED</span>
                  </button>
                ) : effectivePulseStatus === "ended" ? (
                  <button
                    onClick={startPulseQuiz}
                    className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-slate-800 text-slate-400 border border-slate-700 font-bold text-sm cursor-pointer"
                  >
                    <Square className="w-4 h-4 text-slate-500" />
                    <span>PULSE CONCLUDED</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const el = document.getElementById("registration");
                        if (el) el.scrollIntoView({ behavior: "smooth" });
                        else setIsRegisterOpen(true);
                      }}
                      className="relative group inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm tracking-wide shadow-xl shadow-blue-600/30 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Trophy className="w-4 h-4 text-amber-300" />
                      <span>{registered ? "REGISTRATION CONFIRMED" : "REGISTER FOR SEASON 1"}</span>
                      <Sparkles className="w-4 h-4 text-amber-200 group-hover:rotate-12 transition-transform" />
                    </button>

                    <button
                      onClick={startPulseQuiz}
                      className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-sm border border-slate-700 transition cursor-pointer"
                    >
                      <Play className="w-4 h-4 text-emerald-400" />
                      <span>Join Pulse ({seasonStartTimeDisplay || "Scheduled Window"})</span>
                    </button>
                  </>
                )}
              </div>

              {/* Stats Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80">
                <div>
                  <div className="text-xl sm:text-2xl font-black text-white">{leaderboard.length.toLocaleString()}</div>
                  <div className="text-xs text-slate-400">Doctors Registered</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black text-amber-400">18</div>
                  <div className="text-xs text-slate-400">Colleges Competing</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black text-blue-400">5 Daily</div>
                  <div className="text-xs text-slate-400">Pulses / Day</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-300">Obsidian</div>
                  <div className="text-xs text-slate-400">Grand Founder Trophy</div>
                </div>
              </div>
            </div>

            {/* Right Column: Existing 3D Trophy Showcase (PRESERVED) */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center">
              <div className="relative group w-full max-w-sm sm:max-w-md aspect-square rounded-3xl overflow-hidden border border-amber-500/30 bg-gradient-to-b from-amber-500/10 via-slate-900/60 to-slate-950 p-3 shadow-2xl shadow-amber-500/10">
                <div className="relative w-full h-full rounded-2xl overflow-hidden bg-slate-950 flex items-center justify-center">
                  <img
                    src={trophyImg}
                    alt="MedTrail Season 1 Obsidian Trophy"
                    className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/championship-trophy.jpg";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-80" />
                  <div className="absolute bottom-4 left-4 right-4 p-3 rounded-xl bg-slate-900/80 backdrop-blur-md border border-amber-500/30 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">Season 1 Grand Trophy</span>
                      <h4 className="text-sm font-bold text-white">Obsidian & 24K Gold Plated</h4>
                    </div>
                    <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/40">
                      MT-S1-001
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400 text-center mt-3 max-w-xs font-mono">
                Exclusive physical reward forged with natural volcanic obsidian and pure 24-karat gold inlay.
              </p>
            </div>

          </div>
        </section>

        {/* Requirement 3: Dedicated Championship Registration Section */}
        <section id="registration" className="rounded-3xl border border-blue-500/30 bg-gradient-to-b from-[#0F172A] via-[#0B132B] to-[#070B14] p-6 sm:p-10 lg:p-12 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-3xl mx-auto space-y-8">
            
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-bold tracking-wider uppercase">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                OFFICIAL ENTRY PORTAL
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                Season 1 Registration
              </h2>
              <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto">
                Register your profile to represent your medical college and compete in daily pulses
                {seasonStartDisplay
                  ? ` starting ${seasonStartDisplay}${seasonStartTimeDisplay ? ` at ${seasonStartTimeDisplay}` : ""}.`
                  : ". Competition date will be announced."
                }
              </p>
            </div>

            {registered ? (
              <div className="p-8 rounded-3xl bg-slate-900/90 border border-emerald-500/40 space-y-6 shadow-2xl text-center backdrop-blur-md">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                
                {/* Exact confirmation requirement: */}
                <div className="space-y-2">
                  <h3 className="text-xl sm:text-2xl font-black text-white">
                    Registration Confirmed. You're officially participating in MedTrail Championship Season 1.
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300">
                    Your profile has been saved in Supabase and registered for official Season 1 competition rankings.
                  </p>
                </div>

                {/* Confirmed Credential Card */}
                <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 text-left grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Full Name</span>
                    <div className="font-bold text-white text-base">{regName || "Dr. Competitor"}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Medical College</span>
                    <div className="font-semibold text-slate-200 text-sm">{regCollege || "Medical College"}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase">MBBS Batch</span>
                    <div className="font-mono text-blue-300 text-sm font-bold">{regBatch}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Status</span>
                    <div className="font-mono text-emerald-400 text-sm font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Active Season 1 Participant
                    </div>
                  </div>
                  {regPassportId && (
                    <div className="sm:col-span-2 pt-2 border-t border-slate-800/80">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">Passport ID</span>
                      <div className="font-mono text-amber-300 text-xs">{regPassportId}</div>
                    </div>
                  )}
                  {regEmail && (
                    <div className="sm:col-span-2 pt-2 border-t border-slate-800/80">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">Email</span>
                      <div className="font-mono text-slate-300 text-xs">{regEmail}</div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={startPulseQuiz}
                    className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition cursor-pointer"
                  >
                    {seasonRemaining.isLive ? "Join Today's Pulse" : "View Daily Pulses"}
                  </button>
                  <button
                    onClick={() => setIsPassportOpen(true)}
                    className="px-6 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700 transition cursor-pointer"
                  >
                    View Founder Badges
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800/90 shadow-2xl backdrop-blur-xl space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Full Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-blue-400" />
                      Full Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="e.g. Dr. Aayush Sharma"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                    />
                  </div>

                  {/* Medical College */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
                      Medical College <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={regCollege}
                      onChange={(e) => setRegCollege(e.target.value)}
                      placeholder="e.g. BJ Government Medical College, Pune"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                    />
                  </div>

                  {/* Batch (2023–2026) — Requirement 2 exact mapping */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-400" />
                      Batch (2023–2026) <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={regBatch}
                      onChange={(e) => setRegBatch(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    >
                      <option value="2026 Batch → Freshers">2026 Batch → Freshers</option>
                      <option value="2025 Batch → 1st Year MBBS">2025 Batch → 1st Year MBBS</option>
                      <option value="2024 Batch → 2nd Year MBBS">2024 Batch → 2nd Year MBBS</option>
                      <option value="2023 Batch → 3rd Year MBBS">2023 Batch → 3rd Year MBBS</option>
                    </select>
                  </div>

                  {/* Email */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-blue-400" />
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="e.g. doctor@college.edu.in"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  {/* Passport ID (optional) */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      Passport ID (optional)
                    </label>
                    <input
                      type="text"
                      value={regPassportId}
                      onChange={(e) => setRegPassportId(e.target.value)}
                      placeholder="e.g. MT-2026-XXXX (Optional)"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  {liveOps?.registration_open === false ? (
                    <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-center space-y-2">
                      <div className="flex items-center justify-center gap-2 text-rose-300 font-bold text-xs uppercase tracking-wider">
                        <Lock className="w-4 h-4 text-rose-400" />
                        <span>Registration Closed by Administration</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        New competitor registrations have been locked for this event. Verified participants can continue to compete.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSubmittingReg}
                      className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm tracking-wide shadow-xl shadow-blue-600/30 hover:shadow-blue-500/50 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSubmittingReg ? (
                        <>
                          <Clock className="w-4 h-4 animate-spin" />
                          <span>Registering with Supabase...</span>
                        </>
                      ) : (
                        <>
                          <Trophy className="w-4 h-4 text-amber-300" />
                          <span>Confirm Season 1 Registration</span>
                          <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  )}
                  <p className="text-[11px] text-center text-slate-400 mt-3">
                    Stored in Supabase. By confirming, you agree to official MedTrail Season 1 competition terms and fair play rules.
                  </p>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* 2. DYNAMIC DAILY PULSES (STRICT MEDTRAIL ADMIN DATABASE ONLY) */}
        <section id="daily-pulses" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-blue-400 uppercase tracking-widest">
                <Flame className="w-4 h-4 text-amber-400" />
                Admin-Verified Daily Pulse
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
                Today's 5 Pulse Slots
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Created strictly by MedTrail Admin &bull; 5 High-Yield Questions &bull; Unlocks at {seasonStartTimeDisplay || "scheduled window"}.
              </p>
            </div>

            {/* Time window status pill */}
            <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full ${
                timeWindowState.status === "active_pulse"
                  ? "bg-emerald-400 animate-ping"
                  : timeWindowState.status === "day_ended"
                  ? "bg-slate-500"
                  : "bg-amber-400"
              }`} />
              <div>
                <div className="text-xs font-bold text-white">
                  {timeWindowState.status === "active_pulse"
                    ? "WINDOW IS LIVE"
                    : timeWindowState.status === "day_ended"
                    ? "PULSE CONCLUDED"
                    : `LOCKED UNTIL ${seasonStartTimeDisplay || "START TIME"}`}
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {timeWindowState.status === "active_pulse"
                    ? `Elapsed: ${liveElapsed.formatted}`
                    : timeWindowState.status === "day_ended"
                    ? "Submissions closed"
                    : `Opens in ${formatCountdown(timeWindowState.countdownSeconds)}`}
                </div>
              </div>
            </div>
          </div>

          {/* STATE A: Pulse Loading */}
          {isLoadingPulse ? (
            <div className="p-12 rounded-3xl bg-slate-900/50 border border-slate-800 flex flex-col items-center justify-center space-y-3">
              <Clock className="w-8 h-8 text-blue-400 animate-spin" />
              <div className="text-xs font-mono text-slate-300">Connecting to MedTrail Supabase database...</div>
            </div>
          ) : !publishedPulseSet || todayQuestions.length === 0 ? (
            /* STATE B: No Pulse Published Yet by Admin */
            <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950 border border-slate-800/80 text-center space-y-4 shadow-xl">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                <Clock className="w-7 h-7 text-amber-400 animate-pulse" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h3 className="text-xl font-bold text-white">Today's Pulse Has Not Been Published Yet</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Per MedTrail Championship rules, all Pulse questions are crafted strictly by the MedTrail Admin and release at <strong>{seasonStartTimeDisplay || "the scheduled start time"}</strong>. Check back soon!
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] font-mono text-slate-300">
                <span>Date: {getISTDateString()}</span>
                <span>&bull;</span>
                <span className="text-amber-400 font-semibold">Status: Awaiting Admin Publication</span>
              </div>
            </div>
          ) : (
            /* STATE C: Published 5-Question Pulse */
            <>
              {hasAttemptedToday && (
                <div className="p-4 sm:p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-emerald-950/30">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white text-sm">Today's Pulse Completed!</div>
                      <div className="text-emerald-300/90 text-xs">
                        {resultsPublished ? (
                          <>
                            Attempt officially recorded. Score: <strong className="text-amber-300 font-mono">+{todayAttempt?.score ?? quizResult?.score ?? 0} Pts</strong> &bull; Accuracy: <strong className="text-white font-mono">{todayAttempt?.accuracy ?? quizResult?.accuracy ?? 0}%</strong> &bull; XP: <strong className="text-blue-300 font-mono">+{todayAttempt?.xp ?? quizResult?.xp ?? 0}</strong>
                          </>
                        ) : (
                          <>
                            Attempt officially recorded & verified with anti-tamper telemetry. Official scores, rankings, and faculty solutions will be published once results are released by the admin.
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {resultsPublished ? (
                    <button
                      onClick={() => setIsReviewModalOpen(true)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shrink-0 inline-flex items-center gap-2 shadow-md shadow-emerald-600/30"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>View Explanations & Solutions</span>
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 font-mono text-[11px] shrink-0">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Solutions unlock on Result Release</span>
                    </div>
                  )}
                </div>
              )}

              {/* Today's 5 Cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {todayQuestions.map((q) => {
                  const isGeneral = q.category === "General Pulse" || q.subject === "General";
                  return (
                    <div
                      key={q.id}
                      className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between space-y-4 ${
                        isGeneral
                          ? "bg-gradient-to-b from-purple-950/40 via-slate-900/80 to-slate-950 border-purple-500/40 hover:border-purple-500/70"
                          : "bg-slate-900/70 border-slate-800/80 hover:border-blue-500/50"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-bold">
                            Slot #{q.slot}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md font-bold ${
                            isGeneral ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          }`}>
                            {q.subject}
                          </span>
                        </div>

                        <div className="pt-1">
                          <h4 className="text-sm font-semibold text-white line-clamp-3 mt-1 leading-snug">
                            {q.question}
                          </h4>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
                        <span>+{q.xp} XP</span>
                        <span className="text-amber-300 font-bold">+{q.points} Pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between p-4 rounded-2xl bg-blue-950/20 border border-blue-500/30 text-xs text-blue-200 gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>
                    <strong>Admin Verified:</strong> 5 official questions curated directly in MedTrail Pulse Studio.
                  </span>
                </div>
                {hasAttemptedToday ? (
                  <button
                    onClick={() => setIsReviewModalOpen(true)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>View Explanations & Solutions</span>
                  </button>
                ) : (
                  <button
                    onClick={startPulseQuiz}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Play className="w-4 h-4" />
                    <span>Start 5-Pulse Run</span>
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {/* 3. REAL-TIME LEADERBOARD TABS */}
        <section id="leaderboards" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-blue-400 uppercase tracking-widest">
                <Trophy className="w-4 h-4 text-amber-400" />
                Official Season 1 Standings
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
                Championship Leaderboards
              </h2>
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search doctor, college, batch..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Results Published Notice (from competition settings) OR Legacy Freeze Notice */}
          {resultsPublished ? (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                <span><strong>Official Final Results Published:</strong> Season 1 standings are live. Badges awarded to top finishers.</span>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold border border-emerald-500/40 shrink-0">OFFICIAL</span>
            </div>
          ) : (liveOps?.is_leaderboard_frozen || liveOps?.results_declared) ? (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 shadow-lg shadow-amber-500/10">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  <strong>Official Final Results Declared &amp; Leaderboard Frozen:</strong> Season 1 standings are permanently locked. Digital accolades and badges have been awarded.
                </span>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/40 shrink-0">
                LOCKED &amp; FROZEN
              </span>
            </div>
          ) : null}

          {/* 4 Tabs: Global, College, Batch, Weekly */}
          <div className="flex items-center gap-2 border-b border-slate-800 overflow-x-auto pb-1">
            {[
              { id: "global", label: "Individual Ranking", icon: Users },
              { id: "college", label: "College Ranking", icon: GraduationCap },
              { id: "batch", label: "MBBS Batch Ranking", icon: Layers },
              { id: "weekly", label: "Weekly Format", icon: Calendar },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-3 font-semibold text-xs rounded-t-xl transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-slate-900 border-t-2 border-x border-slate-800 border-t-blue-500 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-blue-400" : "text-slate-500"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: INDIVIDUAL RANKING (TOP 5 PUBLIC + PRIVATE PERSONAL PERFORMANCE) */}
          {activeTab === "global" && (
            <div className="space-y-6">
              {/* Leaderboard loading */}
              {loadingLeaderboard && (
                <div className="flex items-center justify-center gap-3 py-8 text-slate-400 text-sm">
                  <Clock className="w-5 h-5 animate-spin text-blue-400" />
                  Loading live leaderboard…
                </div>
              )}

              {/* No entries yet */}
              {!loadingLeaderboard && filteredLeaderboard.length === 0 && (
                <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                  <div className="text-4xl">🏆</div>
                  <h3 className="text-base font-bold text-white">No Submissions Recorded</h3>
                  <p className="text-xs text-slate-400">
                    Official rankings will compute and appear dynamically as verified pulse submissions are recorded.
                  </p>
                </div>
              )}

              {/* Top 5 Leaderboard header & Real-time Indicator */}
              {!loadingLeaderboard && filteredLeaderboard.length > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Top 5 Public Leaderboard &bull; Realtime updates</span>
                  </div>
                  <span className="text-[10px] text-amber-400 font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                    Showing Top 5 Ranked Students
                  </span>
                </div>
              )}

              {/* Top 3 Podium Cards */}
              {!loadingLeaderboard && filteredLeaderboard.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {filteredLeaderboard.slice(0, 3).map((student, idx) => {
                    const medalColors = [
                      "from-amber-500/20 via-yellow-500/10 to-transparent border-amber-500/40 text-amber-300",
                      "from-slate-400/20 via-slate-400/10 to-transparent border-slate-400/40 text-slate-200",
                      "from-amber-700/20 via-amber-700/10 to-transparent border-amber-700/40 text-amber-500",
                    ];
                    return (
                      <div
                        key={student.participant_id}
                        className={`p-5 rounded-2xl border bg-gradient-to-b ${medalColors[idx]} relative overflow-hidden backdrop-blur-md ${
                          student.is_current_user ? "ring-2 ring-blue-500/60 ring-offset-1 ring-offset-slate-950" : ""
                        }`}
                      >
                        {student.is_current_user && (
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-blue-500/30 border border-blue-500/50 text-blue-300 text-[9px] font-bold uppercase tracking-wider">You</div>
                        )}
                        <div className="flex items-start justify-between">
                          <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-slate-700 flex items-center justify-center font-mono font-black text-base">
                            #{idx + 1}
                          </div>
                          <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                            {(student.score ?? 0).toLocaleString()} PTS
                          </span>
                        </div>

                        <div className="mt-4 space-y-1">
                          <h4 className="text-base font-bold text-white truncate">{student.display_name}</h4>
                          <p className="text-xs text-slate-300 truncate">{student.institution}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center text-xs">
                          <div>
                            <div className="text-[10px] text-slate-400 font-mono">Accuracy</div>
                            <div className="font-bold text-emerald-400 mt-0.5">{student.accuracy}%</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400 font-mono">Time</div>
                            <div className="font-bold text-blue-300 mt-0.5">{formatTimeTaken(student.time_taken_seconds ?? 0)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Requirement 1: Top 5 Public Standings Table */}
              {!loadingLeaderboard && filteredLeaderboard.length > 0 && (
                <div className="space-y-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
                    <div className="p-3.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Crown className="w-4 h-4 text-amber-400" />
                        <span className="font-mono font-bold text-white uppercase tracking-wider text-[11px]">
                          TOP 5 OFFICIAL PUBLIC STANDINGS
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Showing Top 5 Only &bull; Ranks Below #5 Hidden
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/80 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                          <tr>
                            <th className="py-3 px-4">Rank</th>
                            <th className="py-3 px-4">Participant</th>
                            <th className="py-3 px-4">Medical College</th>
                            <th className="py-3 px-4 text-center">Accuracy</th>
                            <th className="py-3 px-4 text-center">Time Taken</th>
                            <th className="py-3 px-4 text-right">Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-sans">
                          {filteredLeaderboard.slice(0, 5).map((student) => (
                            <tr
                              key={student.participant_id}
                              className={`transition-colors ${
                                student.is_current_user
                                  ? "bg-blue-500/10 border-l-2 border-blue-500 hover:bg-blue-500/15"
                                  : "hover:bg-slate-800/40"
                              }`}
                            >
                              <td className="py-3 px-4 font-mono font-bold text-slate-300">
                                <span className={`inline-block w-6 text-center ${
                                  student.rank === 1
                                    ? "text-amber-400 font-black"
                                    : student.rank === 2
                                    ? "text-slate-300 font-black"
                                    : student.rank === 3
                                    ? "text-amber-600 font-black"
                                    : "text-slate-400"
                                }`}>
                                  #{student.rank}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="font-semibold text-white">{student.display_name}</div>
                                  {student.is_current_user && (
                                    <span className="px-1.5 py-0.5 rounded-md bg-blue-500/20 border border-blue-500/40 text-blue-300 text-[9px] font-bold">YOU</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 sm:hidden">{student.institution}</div>
                              </td>
                              <td className="py-3 px-4 text-slate-300">{student.institution ?? "—"}</td>
                              <td className="py-3 px-4 text-center font-mono text-emerald-400 font-semibold">{student.accuracy}%</td>
                              <td className="py-3 px-4 text-center font-mono text-blue-300 font-semibold">{formatTimeTaken(student.time_taken_seconds ?? 0)}</td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-white">{(student.score ?? 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="text-center py-1">
                    <span className="text-[11px] font-mono text-slate-500">
                      🔒 Under Championship Privacy Rules, only the Top 5 ranked students are displayed publicly. All ranks below #5 remain private.
                    </span>
                  </div>
                </div>
              )}

              {/* ── REQUIREMENT 2: PERSONAL RANK CARD (PRIVATE) ── */}
              {(user || regEmail || hasAttemptedToday) && (
                <div className="mt-6 p-6 rounded-2xl bg-gradient-to-r from-blue-950/60 via-slate-900/90 to-indigo-950/60 border border-blue-500/40 shadow-xl backdrop-blur-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 -mr-10 -mt-10 w-36 h-36 rounded-full bg-blue-500/10 blur-2xl pointer-events-none" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-blue-500/20 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold shrink-0">
                        <User className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-black text-white">Your Performance</h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 border border-blue-500/40 text-blue-300">
                            PRIVATE
                          </span>
                          {myPerformance && myPerformance.rank <= 5 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300">
                              ⭐ TOP 5 QUALIFIER
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {myPerformance?.display_name || regName || user?.user_metadata?.full_name || "Doctor"} &bull; Verified Championship Participant
                        </p>
                      </div>
                    </div>

                    {(myPerformance || hasAttemptedToday) && (
                      <div className="flex items-center gap-2 self-start sm:self-center">
                        <span className="text-xs text-slate-400 font-mono">Your Rank:</span>
                        <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/30">
                          {myPerformance ? `#${myPerformance.rank}` : "Recorded"}
                        </span>
                      </div>
                    )}
                  </div>

                  {myPerformance ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-1 font-mono text-center">
                      {/* 1. Your Rank */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Your Rank</div>
                        <div className="text-lg font-black text-amber-400 mt-1">
                          #{myPerformance.rank}
                        </div>
                      </div>

                      {/* 2. Your Score */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Your Score</div>
                        <div className="text-lg font-black text-white mt-1">
                          {(myPerformance.score ?? 0).toLocaleString()} <span className="text-xs text-amber-300 font-normal">PTS</span>
                        </div>
                      </div>

                      {/* 3. Accuracy */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Accuracy</div>
                        <div className="text-lg font-black text-emerald-400 mt-1">
                          {myPerformance.accuracy}%
                        </div>
                      </div>

                      {/* 4. Completion Time */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Completion Time</div>
                        <div className="text-lg font-black text-blue-300 mt-1">
                          {formatTimeTaken(myPerformance.time_taken_seconds ?? 0)}
                        </div>
                      </div>

                      {/* 5. College */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 sm:col-span-2 lg:col-span-1 text-left sm:text-center">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">College</div>
                        <div className="text-xs font-bold text-slate-200 mt-1 truncate" title={myPerformance.institution}>
                          {myPerformance.institution || "Medical College"}
                        </div>
                      </div>

                      {/* 6. Batch */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 sm:col-span-1 text-left sm:text-center">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Batch</div>
                        <div className="text-xs font-bold text-blue-300 mt-1 truncate" title={myPerformance.batch}>
                          {myPerformance.batch || "MBBS Batch"}
                        </div>
                      </div>
                    </div>
                  ) : hasAttemptedToday && todayAttempt ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-1 font-mono text-center">
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Your Rank</div>
                        <div className="text-lg font-black text-amber-400 mt-1">
                          Recorded
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Your Score</div>
                        <div className="text-lg font-black text-white mt-1">
                          {todayAttempt.score} <span className="text-xs text-amber-300 font-normal">PTS</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Accuracy</div>
                        <div className="text-lg font-black text-emerald-400 mt-1">
                          {todayAttempt.accuracy}%
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Completion Time</div>
                        <div className="text-lg font-black text-blue-300 mt-1">
                          {formatTimeTaken(todayAttempt.time_taken_seconds ?? 0)}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 sm:col-span-2 lg:col-span-1 text-left sm:text-center">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">College</div>
                        <div className="text-xs font-bold text-slate-200 mt-1 truncate">
                          {regCollege || "Medical College"}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 sm:col-span-1 text-left sm:text-center">
                        <div className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Batch</div>
                        <div className="text-xs font-bold text-blue-300 mt-1 truncate">
                          {regBatch || "2026 Batch → Freshers"}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                      <span className="text-slate-400 text-center sm:text-left">
                        You haven't submitted today's Pulse yet. Complete today's pulse to receive your rank, official score, accuracy, and completion metrics.
                      </span>
                      <button
                        onClick={startPulseQuiz}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shrink-0 cursor-pointer"
                      >
                        Take Today's Pulse
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: COLLEGE RANKINGS (FULLY VISIBLE) */}
          {activeTab === "college" && (
            <div className="space-y-4">
              {collegeRankings.length === 0 ? (
                <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                  <div className="text-4xl">🏛️</div>
                  <h3 className="text-base font-bold text-white">No College Submissions Recorded</h3>
                  <p className="text-xs text-slate-400">Institutional standings will calculate dynamically once verified pulse attempts are recorded.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {collegeRankings.map((c) => (
                    <div
                      key={c.name || c.college}
                      className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 transition-all flex flex-col justify-between space-y-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`w-8 h-8 rounded-xl font-mono text-sm font-black flex items-center justify-center ${
                            c.rank === 1 ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}>
                            #{c.rank}
                          </span>
                          <div>
                            <h4 className="text-base font-bold text-white">{c.name || c.college}</h4>
                            <span className="text-xs text-slate-400">{c.city || "Medical Institution"}</span>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-emerald-400">{c.movement || "• 0"}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800/60">
                        <div className="p-2 rounded-xl bg-slate-950/60">
                          <div className="text-[10px] text-slate-400">Enrolled</div>
                          <div className="font-mono text-xs font-bold text-white mt-0.5">{c.activeStudents || c.participantsCount || 0}</div>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/60">
                          <div className="text-[10px] text-slate-400">Avg Score</div>
                          <div className="font-mono text-xs font-bold text-amber-400 mt-0.5">{c.avgScore || 0}</div>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/60">
                          <div className="text-[10px] text-slate-400">Accuracy</div>
                          <div className="font-mono text-xs font-bold text-emerald-400 mt-0.5">{c.avgAccuracy || "0%"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BATCH RANKINGS — Requirement 2 Mapping */}
          {activeTab === "batch" && (
            <div className="space-y-4">
              {!resultsPublished ? (
                <div className="p-8 rounded-2xl bg-gradient-to-b from-slate-900/80 to-slate-950 border border-slate-700/60 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mx-auto">
                    <Layers className="w-7 h-7 text-amber-400" />
                  </div>
                  <h3 className="text-xl font-black text-white">MBBS Batch Standings</h3>
                  <p className="text-sm text-slate-400 max-w-md mx-auto">
                    Batch-wise rankings across 2026, 2025, 2024, and 2023 MBBS cohorts will be unlocked once official results are declared.
                  </p>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono text-amber-300">
                    <Clock className="w-3.5 h-3.5" />
                    Awaiting admin result publication
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>Official Batch Classification:</strong> 2026 Batch (Freshers), 2025 Batch (1st Year MBBS), 2024 Batch (2nd Year MBBS), and 2023 Batch (3rd Year MBBS).
                    </span>
                  </div>

                  {batchRankings.length === 0 ? (
                    <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                      <div className="text-4xl">📚</div>
                      <h3 className="text-base font-bold text-white">No Batch Submissions Recorded</h3>
                      <p className="text-xs text-slate-400">MBBS cohort standings will calculate dynamically once verified pulse attempts are recorded.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {batchRankings.map((b) => (
                        <div
                          key={b.batch || b.batchName}
                          className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 transition-all flex flex-col justify-between space-y-4"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className={`w-8 h-8 rounded-xl font-mono text-sm font-black flex items-center justify-center ${
                                b.rank === 1 ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-slate-800 text-slate-300 border border-slate-700"
                              }`}>
                                #{b.rank}
                              </span>
                              <div>
                                <h4 className="text-base font-bold text-white">{b.batch || b.batchName}</h4>
                                <span className="text-xs text-blue-400 font-medium">{(b.enrolled || b.participantsCount || 0)} Doctors Enrolled</span>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-mono font-bold">
                              {b.pulseCompletionRate || "100%"}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800/60">
                            <div className="p-2 rounded-xl bg-slate-950/60">
                              <div className="text-[10px] text-slate-400">Total Score</div>
                              <div className="font-mono text-xs font-bold text-white mt-0.5">{(b.totalScore ?? 0).toLocaleString()}</div>
                            </div>
                            <div className="p-2 rounded-xl bg-slate-950/60">
                              <div className="text-[10px] text-slate-400">Avg Accuracy</div>
                              <div className="font-mono text-xs font-bold text-emerald-400 mt-0.5">{b.avgAccuracy || "—"}</div>
                            </div>
                            <div className="p-2 rounded-xl bg-slate-950/60">
                              <div className="text-[10px] text-slate-400">Avg Score</div>
                              <div className="font-mono text-xs font-bold text-amber-400 mt-0.5 truncate">{(b.avgScore ?? 0).toLocaleString()}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 4: WEEKLY FORMAT */}
          {activeTab === "weekly" && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { week: 1, title: "Foundational Pulses", status: "Unlocked", progress: "7 / 7 Active" },
                { week: 2, title: "Clinical Diagnostics", status: "Locks until Oct 4", progress: "0 / 7 Pulses" },
                { week: 3, title: "Therapeutics & High-Yield", status: "Locks until Oct 11", progress: "0 / 7 Pulses" },
                { week: 4, title: "The Grand Championship Run", status: "Finale Week", progress: "0 / 9 Pulses" },
              ].map((w) => (
                <div
                  key={w.week}
                  className={`p-5 rounded-2xl border ${
                    w.week === 1 ? "bg-blue-950/30 border-blue-500/40" : "bg-slate-900/30 border-slate-800/60 opacity-70"
                  } space-y-3`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-amber-400 font-bold">WEEK {w.week}</span>
                    <span className="text-slate-400">{w.status}</span>
                  </div>
                  <h4 className="text-base font-bold text-white">{w.title}</h4>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full"
                      style={{ width: w.week === 1 ? "100%" : "0%" }}
                    />
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
                    <span>Progress</span>
                    <span className="text-white font-bold">{w.progress}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. FOUNDER REWARDS & EXCLUSIVE MERCHANDISE */}
        <section className="space-y-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 uppercase tracking-widest">
              <Crown className="w-4 h-4 text-amber-400" />
              Physical & Digital Accolades
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
              Season 1 Founder Rewards
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Rank 1 wins the physical 24K Gold & Obsidian Trophy. Rank 2 wins the Limited Edition Champion Hoodie.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 1st Place Trophy Showcase */}
            <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-amber-500/10 via-slate-900/80 to-slate-950 border border-amber-500/40 shadow-2xl space-y-6 relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/40 uppercase tracking-wider">
                  <Crown className="w-3.5 h-3.5" /> RANK 1 REWARD
                </span>
                <span className="text-xs font-mono text-amber-400 font-bold">Physical Craft</span>
              </div>

              <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-amber-500/20 shadow-inner flex items-center justify-center">
                <img
                  src={trophyImg}
                  alt="MedTrail Trophy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/championship-trophy.jpg";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <h3 className="text-lg font-black text-white">The Obsidian & 24K Gold Trophy</h3>
                    <p className="text-xs text-amber-300/80 font-mono">Trophy ID: MT-S1-001</p>
                  </div>
                  <span className="px-3 py-1 rounded-xl bg-amber-500 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/30">
                    1 of 1
                  </span>
                </div>
              </div>

              <ul className="space-y-2 text-xs text-slate-300 leading-relaxed font-sans">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  Hand-delivered custom engraved stone with the champion's name and college.
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  Permanent Hall of Fame enshrining across all MedTrail platforms.
                </li>
              </ul>
            </div>

            {/* 2nd Place Hoodie Showcase */}
            <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-blue-500/10 via-slate-900/80 to-slate-950 border border-blue-500/40 shadow-2xl space-y-6 relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/40 uppercase tracking-wider">
                  <Medal className="w-3.5 h-3.5" /> RANK 2 REWARD
                </span>
                <span className="text-xs font-mono text-blue-400 font-bold">Limited Edition</span>
              </div>

              <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-blue-500/20 shadow-inner flex items-center justify-center">
                <img
                  src={hoodieImg}
                  alt="MedTrail Champion Hoodie"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/championship-hoodie.jpg";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <h3 className="text-lg font-black text-white">MedTrail Champion Founder Hoodie</h3>
                    <p className="text-xs text-blue-300/80 font-mono">Item ID: MT-H-S1-002</p>
                  </div>
                  <span className="px-3 py-1 rounded-xl bg-blue-600 text-white text-xs font-black shadow-lg shadow-blue-500/30">
                    Rank 2 Exclusive
                  </span>
                </div>
              </div>

              <ul className="space-y-2 text-xs text-slate-300 leading-relaxed font-sans">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                  Heavyweight 450 GSM French Terry cotton with gold embossed MedTrail emblem.
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                  Custom tailored sleeve embroidery with competitor's handle and rank.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 5. HALL OF FAME — Requirement 1 */}
        <section className="rounded-3xl border border-amber-500/30 bg-gradient-to-r from-slate-950 via-[#10172A] to-slate-950 p-6 sm:p-10 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 text-xl font-bold">
                🏆
              </div>
              <div>
                <span className="text-xs font-mono font-bold tracking-widest text-amber-400 uppercase">Permanent Archive</span>
                <h3 className="text-2xl font-black text-white">MedTrail Hall of Fame</h3>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-mono font-bold text-amber-300">
              IMMUTABLE RECORD
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Dynamic Champion Card — Connected to Super Admin Hall of Fame Manager */}
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-amber-500/40 space-y-4 relative overflow-hidden shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-400">
                  {hallOfFame.season_title || "MedTrail Championship: Season 1"}
                </span>
                <span className="px-2.5 py-1 rounded-full font-mono text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Trophy ID: {hallOfFame.trophy_id}
                </span>
              </div>

              <div className="flex items-center gap-4">
                {hallOfFame.winner_photo ? (
                  <img
                    src={hallOfFame.winner_photo}
                    alt={hallOfFame.champion_name}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-amber-500 shadow-lg shadow-amber-500/30"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/30">
                    {hallOfFame.champion_name.slice(0, 3).toUpperCase()}
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                    Reigning Crown Champion
                  </div>
                  <h4 className="text-xl font-black text-white">{hallOfFame.champion_name}</h4>
                  <div className="text-xs text-slate-300">{hallOfFame.college}</div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-semibold">
                      <Clock className="w-3 h-3 text-blue-400" />
                      Status: {hallOfFame.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200/90 leading-relaxed">
                <strong>Season Inscription:</strong> {hallOfFame.champion_name} ({hallOfFame.college}) is enshrined under Trophy ID {hallOfFame.trophy_id} with official accolade status: "{hallOfFame.status}".
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center font-mono">
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Champion</div>
                  <div className="font-bold text-xs text-amber-300 mt-0.5 truncate">{hallOfFame.champion_name}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Trophy ID</div>
                  <div className="font-bold text-xs text-white mt-0.5">{hallOfFame.trophy_id}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Status</div>
                  <div className="font-bold text-[11px] text-blue-300 mt-0.5 truncate">{hallOfFame.status}</div>
                </div>
              </div>
            </div>

            {/* Upcoming Season 2 Slot */}
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 flex flex-col items-center justify-center text-center space-y-3">
              <span className="text-3xl">⏳</span>
              <h4 className="text-base font-bold text-slate-300">Season 2 — Winter 2026</h4>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                The next sovereign champion will be permanently inscribed into the Hall of Fame upon the conclusion of Season 2.
              </p>
              <span className="px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] font-mono text-slate-400">
                Trophy ID: MT-S2-001 (Locked)
              </span>
            </div>
          </div>
        </section>

        {/* 6. RULES & FAIR PLAY SECTION */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 sm:p-10 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Official Championship Code & Rules</h3>
              <p className="text-xs text-slate-400">Policy Version: S1-v1.0 &bull; Ethical play & transparency guarantee</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RULES.map((rule, idx) => (
              <div key={idx} className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <h4 className="text-sm font-bold text-blue-200 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-400" />
                  {rule.title}
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">{rule.content}</p>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* POPUP MODAL: Interactive Pulse Quiz */}
      {isQuizOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-blue-500/40 p-6 sm:p-8 space-y-6 shadow-2xl relative">
            <button
              onClick={() => setIsQuizOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {!quizFinished ? (
              <div className="space-y-5">
                {/* Header: Slot + Real-Time 60s Pulse Countdown Timer + Points */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider">
                        Daily Pulse Slot {currentQIndex + 1} of {todayQuestions.length}
                      </span>
                      {adminPulseStatus === "paused" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          Paused
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Pulse Countdown Timer Pill */}
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border transition-all duration-300 ${
                          timerSecondsLeft <= 10
                            ? "bg-rose-500/20 text-rose-300 border-rose-500/50 animate-pulse shadow-sm shadow-rose-500/30"
                            : timerSecondsLeft <= 20
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        }`}
                        title="Pulse Countdown Timer (60s Limit)"
                      >
                        <Clock
                          className={`w-3.5 h-3.5 ${
                            timerSecondsLeft <= 10
                              ? "text-rose-400 animate-pulse"
                              : timerSecondsLeft <= 20
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }`}
                        />
                        <span>00:{timerSecondsLeft.toString().padStart(2, "0")}</span>
                      </div>

                      <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300">
                        {todayQuestions[currentQIndex]?.points ?? 50} Pts
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  {(() => {
                    const currentQ = todayQuestions[currentQIndex];
                    const qDuration = currentQ?.time_limit_seconds || DEFAULT_PULSE_TIMER_SECONDS;
                    const pct = Math.max(0, Math.min(100, (timerSecondsLeft / qDuration) * 100));
                    return (
                      <div className="w-full space-y-1">
                        <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                              timerSecondsLeft <= 10
                                ? "bg-gradient-to-r from-rose-600 to-red-500 animate-pulse"
                                : timerSecondsLeft <= 20
                                ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                                : "bg-gradient-to-r from-cyan-500 to-emerald-400"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {timerSecondsLeft <= 10 && !hasSubmittedAnswer && (
                          <div className="flex items-center justify-between text-[10px] font-mono text-rose-400 font-semibold px-0.5 animate-pulse">
                            <span>⚡ Final seconds!</span>
                            <span>Auto-submitting in {timerSecondsLeft}s</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-mono font-bold text-slate-400 uppercase">
                    {todayQuestions[currentQIndex]?.subject || "Medical"} &bull; {todayQuestions[currentQIndex]?.category || "Pulse"}
                  </span>
                  <h3 className="text-lg font-bold text-white leading-relaxed">
                    {todayQuestions[currentQIndex]?.question || "Clinical vignette loading..."}
                  </h3>
                </div>

                {hasAttemptedToday && (
                  <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center gap-2.5 text-amber-300 text-xs font-medium">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                    <span>You have already submitted this Pulse.</span>
                  </div>
                )}

                <div className="space-y-2.5">
                  {(todayQuestions[currentQIndex]?.options || []).map((opt, optIdx) => {
                    const isSelected = selectedOption === optIdx;
                    const isCorrect = todayQuestions[currentQIndex]?.correctIndex === optIdx;

                    let btnClass = "border-slate-800 bg-slate-950/70 hover:border-blue-500/50 text-slate-200";
                    if (hasSubmittedAnswer) {
                      if (isCorrect) {
                        btnClass = "border-emerald-500/80 bg-emerald-500/20 text-emerald-200";
                      } else if (isSelected) {
                        btnClass = "border-red-500/80 bg-red-500/20 text-red-200";
                      }
                    } else if (isSelected) {
                      btnClass = "border-blue-500 bg-blue-600/20 text-white";
                    }

                    return (
                      <button
                        key={optIdx}
                        disabled={hasAttemptedToday || hasSubmittedAnswer}
                        onClick={() => handleSelectOption(optIdx)}
                        className={`w-full p-4 rounded-xl border text-left text-xs sm:text-sm font-medium transition flex items-center justify-between ${
                          hasAttemptedToday ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                        } ${btnClass}`}
                      >
                        <span>{opt}</span>
                        {hasSubmittedAnswer && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2">
                  <button
                    disabled={hasAttemptedToday || selectedOption === null || hasSubmittedAnswer}
                    onClick={handleSubmitQuestion}
                    className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-wider transition"
                  >
                    {hasAttemptedToday
                      ? "You have already submitted this Pulse"
                      : currentQIndex === todayQuestions.length - 1
                      ? "Submit Final Pulse"
                      : "Confirm Answer &rarr;"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-6 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
                  <Trophy className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-white">Today's Pulse Complete!</h3>
                  <p className="text-xs text-slate-400">
                    Attempt verified by server-side anti-tamper telemetry and recorded in Supabase.
                  </p>
                </div>

                {resultsPublished ? (
                  <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-400 font-sans">Score</div>
                      <div className="text-lg font-bold text-amber-400 mt-0.5">+{quizResult?.score}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-sans">Accuracy</div>
                      <div className="text-lg font-bold text-emerald-400 mt-0.5">{quizResult?.accuracy}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-sans">XP Earned</div>
                      <div className="text-lg font-bold text-blue-400 mt-0.5">+{quizResult?.xp}</div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-amber-300 text-xs font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Results & Faculty Explanations Awaiting Release</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      To preserve championship integrity, official rankings, final scores, and detailed faculty solutions remain sealed until the administrator declares official results.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  {resultsPublished && (
                    <button
                      onClick={() => {
                        setIsQuizOpen(false);
                        setIsReviewModalOpen(true);
                      }}
                      className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wider uppercase transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>View Explanations</span>
                    </button>
                  )}
                  <button
                    onClick={() => setIsQuizOpen(false)}
                    className="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs tracking-wider uppercase transition cursor-pointer"
                  >
                    Return to Board
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* POPUP MODAL: Pulse Explanations & Results Review */}
      {isReviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-emerald-500/40 p-6 sm:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsReviewModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Today's Pulse &bull; Faculty Explanations</h3>
                <p className="text-xs text-slate-400">
                  Official clinical explanations authored by MedTrail Faculty &bull; Date: {publishedPulseSet?.pulse_date || getISTDateString()}
                </p>
              </div>
            </div>

            {/* Performance summary if student attempted */}
            {resultsPublished && (todayAttempt || quizResult) && (
              <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center font-mono">
                <div>
                  <div className="text-[10px] text-slate-400 font-sans">Score</div>
                  <div className="text-lg font-bold text-amber-400 mt-0.5">
                    +{todayAttempt?.score ?? quizResult?.score ?? 0} Pts
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-sans">Accuracy</div>
                  <div className="text-lg font-bold text-emerald-400 mt-0.5">
                    {todayAttempt?.accuracy ?? quizResult?.accuracy ?? 0}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-sans">XP Earned</div>
                  <div className="text-lg font-bold text-blue-400 mt-0.5">
                    +{todayAttempt?.xp ?? quizResult?.xp ?? 0} XP
                  </div>
                </div>
              </div>
            )}

            {!resultsPublished ? (
              <div className="p-8 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-amber-400">
                  <Clock className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-white">Faculty Solutions & Answer Keys Sealed</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Detailed question solutions, faculty clinical rationales, and official answer keys will unlock
                  once official results are published by the admin in Result Control.
                </p>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-amber-300">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Awaiting Admin Result Publication</span>
                </div>
              </div>
            ) : (
              /* 5 Questions Review List */
              <div className="space-y-4">
              {todayQuestions.map((q, qIdx) => {
                const userChoice = userAnswers[qIdx] !== undefined ? userAnswers[qIdx] : null;
                const isCorrect = userChoice === q.correctIndex;

                return (
                  <div
                    key={q.id || qIdx}
                    className="p-5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          Q{qIdx + 1}
                        </span>
                        <span className="font-semibold text-blue-400">{q.subject}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">+{q.xp} XP</span>
                        {userChoice !== null && (
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isCorrect
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : userChoice === -1
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-red-500/20 text-red-300 border border-red-500/30"
                            }`}
                          >
                            {isCorrect
                              ? `Correct (+${q.points || 50} Pts)`
                              : userChoice === -1
                              ? "Timed Out (0 Pts)"
                              : "Incorrect"}
                          </span>
                        )}
                      </div>
                    </div>

                    <h4 className="text-sm font-semibold text-white leading-relaxed">
                      {q.question}
                    </h4>

                    {/* Options Breakdown */}
                    <div className="space-y-1.5">
                      {q.options.map((opt, optIdx) => {
                        const optLetter = ["A", "B", "C", "D"][optIdx];
                        const isThisCorrect = q.correctIndex === optIdx;
                        const isThisUserPick = userChoice !== -1 && userChoice === optIdx;

                        let style = "bg-slate-900/60 border-slate-800 text-slate-300";
                        if (isThisCorrect) {
                          style = "bg-emerald-950/40 border-emerald-500/60 text-emerald-200 font-semibold";
                        } else if (isThisUserPick && !isThisCorrect) {
                          style = "bg-red-950/40 border-red-500/50 text-red-300 line-through";
                        }

                        return (
                          <div
                            key={optIdx}
                            className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${style}`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-400">{optLetter}.</span>
                              <span>{opt}</span>
                            </span>
                            <span className="text-[10px] font-mono shrink-0">
                              {isThisCorrect && (
                                <span className="text-emerald-400 font-bold flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Correct
                                </span>
                              )}
                              {isThisUserPick && !isThisCorrect && (
                                <span className="text-red-400 font-bold">Your choice</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Faculty Explanation */}
                    {q.explanation && (
                      <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 space-y-1 text-xs text-blue-200">
                        <div className="font-bold flex items-center gap-1.5 text-blue-300 text-[11px] uppercase tracking-wide">
                          <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                          Faculty Explanation
                        </div>
                        <p className="leading-relaxed text-slate-300">{q.explanation}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => setIsReviewModalOpen(false)}
                className="w-full py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Close Explanations
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: Founder Badges Album */}
      {isPassportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-amber-500/30 p-6 sm:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsPassportOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold">
                🏅
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Season 1 Founder Badges</h3>
                <p className="text-xs text-slate-400">Rare passport accolades unlockable during Season 1</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CHAMPIONSHIP_ALBUM_BADGES.map((b) => (
                <div key={b.id} className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">{b.icon}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      {b.rarity}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{b.title}</h4>
                  <p className="text-xs text-slate-400">{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: Quick Register Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-blue-500/30 p-6 sm:p-8 space-y-6 shadow-2xl relative">
            <button
              onClick={() => setIsRegisterOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-1">
              <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-widest">Season 1 Portal</span>
              <h3 className="text-2xl font-black text-white">Season 1 Registration</h3>
              <p className="text-xs text-slate-400">Enter competitor details to be registered into Supabase</p>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-xs font-sans">
              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Full Name *</label>
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g. Dr. Aayush Sharma"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Medical College *</label>
                <input
                  type="text"
                  required
                  value={regCollege}
                  onChange={(e) => setRegCollege(e.target.value)}
                  placeholder="e.g. BJ Government Medical College, Pune"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Batch (2023–2026) *</label>
                <select
                  value={regBatch}
                  onChange={(e) => setRegBatch(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="2026 Batch → Freshers">2026 Batch → Freshers</option>
                  <option value="2025 Batch → 1st Year MBBS">2025 Batch → 1st Year MBBS</option>
                  <option value="2024 Batch → 2nd Year MBBS">2024 Batch → 2nd Year MBBS</option>
                  <option value="2023 Batch → 3rd Year MBBS">2023 Batch → 3rd Year MBBS</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Email *</label>
                <input
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="e.g. doctor@college.edu.in"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Passport ID (optional)</label>
                <input
                  type="text"
                  value={regPassportId}
                  onChange={(e) => setRegPassportId(e.target.value)}
                  placeholder="e.g. MT-2026-XXXX (Optional)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {liveOps?.registration_open === false ? (
                <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-center space-y-1">
                  <div className="flex items-center justify-center gap-1.5 text-rose-300 font-bold text-xs uppercase tracking-wider">
                    <Lock className="w-3.5 h-3.5 text-rose-400" />
                    <span>Registration Closed</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    New sign-ups have been locked by administration.
                  </p>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmittingReg}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-blue-600/30 disabled:opacity-50"
                >
                  {isSubmittingReg ? "Registering with Supabase..." : "Confirm Registration"}
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
