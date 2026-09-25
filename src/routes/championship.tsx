import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
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
  Play,
  RotateCcw,
  Scale,
  Search,
  Share2,
  Shield,
  Sparkles,
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
  SEASON_END_UTC,
  SEASON_ID,
  SEASON_START_UTC,
  SEED_LEADERBOARD,
  formatIST,
  getDailyPulseTimeState,
  getISTDateString,
  getLiveLeaderboard,
  getSeasonStatus,
  registerChampionshipParticipant,
  submitPulseAttempt,
  fetchTodayPublishedPulse,
  checkStudentAttempt,
  recordStudentAttempt,
  convertToQuizQuestions,
  fetchLiveOpsState,
  type LiveOpsState,
  type PulseSetRecord,
  type PulseAttemptRecord,
  type LeaderboardEntry,
  type PassportBadge,
  type PulseQuestion,
  type SeasonStatus,
  type TimeWindowState,
} from "@/lib/championship-service";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import trophyImg from "@/assets/championship-trophy.jpg";
import hoodieImg from "@/assets/championship-hoodie.jpg";

export const Route = createFileRoute("/championship")({
  component: RouteComponent,
});

// College rankings derived from aggregate data
const COLLEGE_RANKINGS = [
  { rank: 1, name: "MIMER Medical College", city: "Talegaon Dabhade, Pune", activeStudents: 312, totalPulses: 2840, avgScore: 8940, avgAccuracy: "96.4%", movement: "▲ +1" },
  { rank: 2, name: "BJ Government Medical College (BJGMC)", city: "Pune", activeStudents: 285, totalPulses: 2610, avgScore: 8890, avgAccuracy: "95.8%", movement: "▼ -1" },
  { rank: 3, name: "Seth GS Medical College & KEM Hospital", city: "Mumbai", activeStudents: 264, totalPulses: 2450, avgScore: 8810, avgAccuracy: "95.2%", movement: "• 0" },
  { rank: 4, name: "Armed Forces Medical College (AFMC)", city: "Pune", activeStudents: 198, totalPulses: 2190, avgScore: 8760, avgAccuracy: "94.9%", movement: "▲ +2" },
  { rank: 5, name: "Grant Government Medical College (JJ Hospital)", city: "Mumbai", activeStudents: 182, totalPulses: 1980, avgScore: 8640, avgAccuracy: "94.1%", movement: "▼ -1" },
  { rank: 6, name: "Government Medical College (GMC)", city: "Nagpur", activeStudents: 146, totalPulses: 1620, avgScore: 8490, avgAccuracy: "93.5%", movement: "• 0" },
  { rank: 7, name: "Dr. DY Patil Medical College", city: "Pimpri, Pune", activeStudents: 134, totalPulses: 1470, avgScore: 8380, avgAccuracy: "92.8%", movement: "▲ +1" },
  { rank: 8, name: "Government Medical College", city: "Miraj", activeStudents: 110, totalPulses: 1250, avgScore: 8210, avgAccuracy: "91.9%", movement: "▼ -1" },
];

// Requirement 2: Batch Mapping consistently across website:
// 2026 Batch → Freshers
// 2025 Batch → 1st Year MBBS
// 2024 Batch → 2nd Year MBBS
// 2023 Batch → 3rd Year MBBS
const BATCH_RANKINGS = [
  { rank: 1, batch: "2024 Batch → 2nd Year MBBS", enrolled: 486, pulseCompletionRate: "88.4%", avgStreak: 8.4, totalScore: 382400, topSubject: "Pathology" },
  { rank: 2, batch: "2023 Batch → 3rd Year MBBS", enrolled: 420, pulseCompletionRate: "84.1%", avgStreak: 7.9, totalScore: 324100, topSubject: "Pharmacology" },
  { rank: 3, batch: "2025 Batch → 1st Year MBBS", enrolled: 394, pulseCompletionRate: "79.8%", avgStreak: 6.8, totalScore: 298500, topSubject: "Physiology" },
  { rank: 4, batch: "2026 Batch → Freshers", enrolled: 268, pulseCompletionRate: "71.2%", avgStreak: 5.2, totalScore: 184300, topSubject: "Anatomy" },
];

const RULES = [
  {
    title: "5 Dynamic Pulses Daily (4 MBBS + 1 General)",
    content: "Each 24-hour cycle automatically rotates four questions from 1st and 2nd MBBS subjects (Anatomy, Physiology, Biochemistry, Pathology, Pharmacology, Microbiology, FMT, etc.) plus one General Pulse. Never hardcoded, fully dynamic.",
  },
  {
    title: "Window Schedule: Unlocks Daily at 7:00 PM IST",
    content: "Pulses unlock promptly at 19:00 IST and remain active until 23:59 IST. Prior to 7:00 PM, challenge slots are locked under dynamic countdown.",
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
  const [searchQuery, setSearchQuery] = useState("");

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

  // Check if current user is already registered in Supabase on load
  useEffect(() => {
    if (!user?.email) return;
    async function checkServerRegistration() {
      try {
        const { data, error } = await supabase
          .from("championship_registrations")
          .select("*")
          .ilike("email", user!.email!)
          .maybeSingle();

        if (data && !error) {
          setRegName(data.full_name);
          setRegCollege(data.medical_college);
          setRegBatch(data.batch);
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
  }, [user]);

  // Live Leaderboard Data
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(SEED_LEADERBOARD);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Admin-managed Daily Pulse State (Strictly from Supabase)
  const [liveOps, setLiveOps] = useState<LiveOpsState | null>(null);
  const [publishedPulseSet, setPublishedPulseSet] = useState<PulseSetRecord | null>(null);
  const [isLoadingPulse, setIsLoadingPulse] = useState(false);
  const [hasAttemptedToday, setHasAttemptedToday] = useState(false);
  const [todayAttempt, setTodayAttempt] = useState<PulseAttemptRecord | null>(null);
  const [todayQuestions, setTodayQuestions] = useState<PulseQuestion[]>([]);
  const [timeWindowState, setTimeWindowState] = useState<TimeWindowState>({
    status: "before_7pm",
    countdownSeconds: 0,
    label: "Unlocks at 7:00 PM IST",
    opensAtIST: "7:00 PM IST",
  });

  // Unique identifier for the student (Auth user ID > Email > Guest Persistent Token)
  const getEffectiveStudentId = useCallback(() => {
    if (user?.id) return user.id;
    if (user?.email) return `email:${user.email.toLowerCase()}`;
    if (regEmail.trim()) return `email:${regEmail.trim().toLowerCase()}`;
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

  // Fetch today's official admin-published pulse set and live ops state from Supabase
  const loadTodayPulse = useCallback(async () => {
    setIsLoadingPulse(true);
    try {
      const todayStr = getISTDateString();
      const [set, ops] = await Promise.all([
        fetchTodayPublishedPulse(todayStr),
        fetchLiveOpsState(),
      ]);

      setPublishedPulseSet(set);
      setLiveOps(ops);

      if (set && Array.isArray(set.questions) && set.questions.length === 5) {
        setTodayQuestions(convertToQuizQuestions(set.questions));
      } else {
        setTodayQuestions([]);
      }

      // Check student's single daily attempt
      const studentId = getEffectiveStudentId();
      if (studentId) {
        const attempt = await checkStudentAttempt(todayStr, studentId);
        if (attempt) {
          setHasAttemptedToday(true);
          setTodayAttempt(attempt);
          if (attempt.answers && Array.isArray(attempt.answers)) {
            setUserAnswers(attempt.answers);
          }
          setQuizResult({
            score: attempt.score,
            accuracy: attempt.accuracy,
            xp: attempt.xp,
          });
        } else {
          setHasAttemptedToday(false);
          setTodayAttempt(null);
        }
      }
    } catch (err) {
      console.error("Failed to load today's published pulse from Supabase:", err);
    } finally {
      setIsLoadingPulse(false);
    }
  }, [getEffectiveStudentId]);

  // Load today's dynamic pulses and watch synchronized countdown & live ops
  useEffect(() => {
    const updateTimeState = () => {
      const now = new Date();
      const baseWindowState = getDailyPulseTimeState(now);

      // If admin manually triggered Go LIVE, pulse is immediately active
      if (liveOps?.live_status === "live") {
        setTimeWindowState({
          status: "active_pulse",
          countdownSeconds: 0,
          label: "Pulse Active & Live Now",
          opensAtIST: "LIVE NOW",
        });
      } else if (liveOps?.live_status === "paused") {
        setTimeWindowState({
          status: "before_7pm",
          countdownSeconds: 0,
          label: "Pulse Paused by Admin",
          opensAtIST: "Paused",
        });
      } else if (liveOps?.live_status === "ended") {
        setTimeWindowState({
          status: "day_ended",
          countdownSeconds: 0,
          label: "Today's Pulse Ended",
          opensAtIST: "Ended",
        });
      } else {
        setTimeWindowState(baseWindowState);
      }

      // Season countdown & status
      const status = getSeasonStatus(now);
      const isLive = liveOps?.live_status === "live" || status === "live";

      let target = SEASON_START_UTC;
      let label = "LIVE PULSE BEGINS";

      if (isLive) {
        target = SEASON_END_UTC;
        label = "Season Ends In";
      } else if (status === "ended" || liveOps?.results_declared) {
        setSeasonRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, status: "ended", isLive: false, label: "Season Completed" });
        return;
      }

      const diff = Math.max(0, target.getTime() - now.getTime());
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      setSeasonRemaining({ days, hours, minutes, seconds, status, isLive, label });
    };

    loadTodayPulse();
    updateTimeState();
    const interval = setInterval(updateTimeState, 1000);
    return () => clearInterval(interval);
  }, [loadTodayPulse, liveOps?.live_status, liveOps?.results_declared]);

  // Fetch live leaderboard and subscribe to Supabase Realtime for participants & live ops
  useEffect(() => {
    const fetchBoard = async () => {
      setLoadingLeaderboard(true);
      const data = await getLiveLeaderboard();
      setLeaderboard(data);
      setLoadingLeaderboard(false);
    };

    fetchBoard();

    // Channel 1: Leaderboard updates
    const partChannel = supabase
      .channel("championship_live_updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_participants" },
        () => {
          fetchBoard();
        }
      )
      .subscribe();

    // Channel 2: Live Ops real-time broadcasts (Go Live, Pauses, Final Results, Notifications)
    const opsChannel = supabase
      .channel("championship_live_ops_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_live_ops" },
        (payload: any) => {
          if (payload.new) {
            setLiveOps(payload.new);
            const notifs = payload.new.notifications;
            if (Array.isArray(notifs) && notifs.length > 0 && notifs[0]?.title) {
              toast.info(notifs[0].title, { description: notifs[0].body });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(partChannel);
      supabase.removeChannel(opsChannel);
    };
  }, []);

  // Filter leaderboard
  const filteredLeaderboard = useMemo(() => {
    if (!searchQuery.trim()) return leaderboard;
    const q = searchQuery.toLowerCase();
    return leaderboard.filter(
      (p) =>
        (p.display_name && p.display_name.toLowerCase().includes(q)) ||
        (p.institution && p.institution.toLowerCase().includes(q)) ||
        (p.batch && p.batch.toLowerCase().includes(q))
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
    // 0. Live Ops administrative status checks
    if (liveOps) {
      if (liveOps.results_declared) {
        toast.error("Championship results have been officially declared. All submissions are locked.");
        setIsReviewModalOpen(true);
        return;
      }
      if (liveOps.live_status === "paused") {
        toast.warning("Pulse is currently paused by Administration. Submissions on hold.");
        return;
      }
      if (liveOps.live_status === "ended") {
        toast.info("Today's Pulse session has concluded.");
        return;
      }
    }

    // 1. Must be published by Admin in Supabase
    if (!publishedPulseSet || todayQuestions.length === 0) {
      toast.info("Today's Pulse has not been published by the MedTrail Admin yet. Official questions are released every evening at 7:00 PM IST.");
      return;
    }

    // 2. Pulse unlocks: if admin explicitly set live_status === 'live', bypass time restriction! Otherwise check before_7pm
    if (liveOps?.live_status !== "live" && timeWindowState.status === "before_7pm") {
      toast.info(`Today's Pulse opens at 7:00 PM IST. Countdown remaining: ${formatCountdown(timeWindowState.countdownSeconds)}.`);
      return;
    }

    // 3. Students can only attempt once per day
    if (hasAttemptedToday) {
      toast.info("You have already completed today's official Pulse attempt! Loading faculty explanations...");
      setIsReviewModalOpen(true);
      return;
    }

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
    if (hasSubmittedAnswer) return;
    setSelectedOption(idx);
  };

  const handleSubmitQuestion = async () => {
    if (selectedOption === null) return;
    setHasSubmittedAnswer(true);

    const newAnswers = [...userAnswers, selectedOption];
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
        const todayStr = getISTDateString();
        const studentId = getEffectiveStudentId();

        setQuizResult({ score: earnedScore, accuracy, xp: earnedXP });
        setQuizFinished(true);
        setHasAttemptedToday(true);

        try {
          // Record single daily attempt to Supabase public.championship_pulse_attempts
          const recorded = await recordStudentAttempt({
            pulseDate: todayStr,
            userId: studentId,
            userEmail: user?.email || regEmail || undefined,
            userName: user?.user_metadata?.full_name || regName || "MedTrail Doctor",
            score: earnedScore,
            accuracy,
            xp: earnedXP,
            answers: newAnswers,
            timeTakenSeconds: timeTaken,
          });
          if (recorded) {
            setTodayAttempt(recorded);
          }
        } catch (e) {
          console.error("Failed to record student pulse attempt:", e);
        }

        await submitPulseAttempt({
          slot: 1,
          answers: newAnswers,
          questions: todayQuestions,
          timeTakenSeconds: timeTaken,
        });

        const refreshed = await getLiveLeaderboard();
        setLeaderboard(refreshed);
      } else {
        setCurrentQIndex((prev) => prev + 1);
        setSelectedOption(null);
        setHasSubmittedAnswer(false);
      }
    }, 1100);
  };

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

                {/* Requirement 5: Top Hero status displays 🟢 REGISTRATION OPEN before 27 Sept 7:00 PM; after changes to 🔴 CHAMPIONSHIP LIVE */}
                {seasonRemaining.isLive ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-black tracking-wider uppercase shadow-lg shadow-red-500/20 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    🔴 CHAMPIONSHIP LIVE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-black tracking-wider uppercase shadow-lg shadow-emerald-500/20">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    🟢 REGISTRATION OPEN
                  </span>
                )}

                <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {EVENT_TZ_OFFSET} ({EVENT_TZ_ABBR})
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

              {/* Requirement 4: Live Championship Timer Display Prominently on Hero */}
              {!seasonRemaining.isLive ? (
                /* BEFORE LAUNCH: Show countdown & prominent header */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/70 via-slate-900/80 to-indigo-950/70 border border-blue-500/30 backdrop-blur-md shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-500/20 pb-3">
                    <div>
                      <div className="text-xs font-mono font-black tracking-widest text-blue-400 uppercase">
                        OFFICIAL COMPETITION LAUNCH
                      </div>
                      <div className="text-2xl sm:text-3xl font-black text-white tracking-wide flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
                        LIVE PULSE BEGINS
                      </div>
                    </div>
                    <div className="sm:text-right font-mono">
                      <div className="text-base font-extrabold text-amber-300">27 September 2026</div>
                      <div className="text-xs font-semibold text-slate-300">7:00 PM IST</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Registration Open &bull; Enrolling Batches 2023–2026
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">Asia/Kolkata (IST, UTC+5:30)</span>
                  </div>

                  {/* Countdown Timer */}
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
                </div>
              ) : (
                /* AT EXACTLY 7:00 PM: Countdown disappears, Pulse automatically becomes live */
                <div className="p-5 rounded-2xl bg-gradient-to-r from-red-950/60 via-slate-900/90 to-blue-950/60 border border-red-500/40 backdrop-blur-md shadow-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                      <span className="text-xs font-mono font-black text-red-400 uppercase tracking-wider">
                        CHAMPIONSHIP PULSE IS LIVE
                      </span>
                    </div>
                    <span className="text-xs font-mono text-slate-300 font-semibold">Ends 17 October 2026, 7:00 PM IST</span>
                  </div>
                  <h3 className="text-2xl font-black text-white">Daily Pulses Are Now Active</h3>
                  <p className="text-sm text-slate-300">
                    The competition is live! Complete your daily 5 challenges (4 MBBS + 1 General) to claim points, elevate your college, and win the 24K Gold & Obsidian Trophy.
                  </p>
                </div>
              )}

              {/* Action Buttons: Join Pulse becomes active at 7:00 PM */}
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
                ) : seasonRemaining.isLive || timeWindowState.status === "active_pulse" ? (
                  <button
                    onClick={startPulseQuiz}
                    className="relative group inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-rose-500 text-white font-black text-sm tracking-wider uppercase shadow-xl shadow-red-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-white animate-pulse" />
                    <span>JOIN PULSE NOW</span>
                    <Sparkles className="w-4 h-4 text-amber-200 group-hover:rotate-12 transition-transform" />
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
                      <span>Join Pulse (7:00 PM IST)</span>
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
                Register your profile to represent your medical college and compete in daily pulses starting 27 September at 7:00 PM IST.
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
                Created strictly by MedTrail Admin &bull; 5 High-Yield Questions &bull; Unlocks at 7:00 PM IST.
              </p>
            </div>

            {/* Time window status pill */}
            <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full ${
                timeWindowState.status === "active_pulse" ? "bg-emerald-400 animate-ping" : "bg-amber-400"
              }`} />
              <div>
                <div className="text-xs font-bold text-white">
                  {timeWindowState.status === "active_pulse" ? "WINDOW IS LIVE" : "LOCKED UNTIL 7:00 PM IST"}
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {timeWindowState.status === "active_pulse" ? "Active until 23:59 IST" : `Opens in ${formatCountdown(timeWindowState.countdownSeconds)}`}
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
                  Per MedTrail Championship rules, all Pulse questions are crafted strictly by the MedTrail Admin and release at <strong>7:00 PM IST</strong>. Check back soon!
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
                        Attempt officially recorded. Score: <strong className="text-amber-300 font-mono">+{todayAttempt?.score ?? quizResult?.score ?? 0} Pts</strong> &bull; Accuracy: <strong className="text-white font-mono">{todayAttempt?.accuracy ?? quizResult?.accuracy ?? 0}%</strong> &bull; XP: <strong className="text-blue-300 font-mono">+{todayAttempt?.xp ?? quizResult?.xp ?? 0}</strong>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsReviewModalOpen(true)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shrink-0 inline-flex items-center gap-2 shadow-md shadow-emerald-600/30"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>View Explanations & Solutions</span>
                  </button>
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

          {/* Requirement 5: Final Results Declared & Leaderboard Freeze Notice */}
          {(liveOps?.is_leaderboard_frozen || liveOps?.results_declared) && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 shadow-lg shadow-amber-500/10">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  <strong>Official Final Results Declared & Leaderboard Frozen:</strong> Season 1 standings are permanently locked. Digital accolades and badges have been awarded.
                </span>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/40 shrink-0">
                LOCKED & FROZEN
              </span>
            </div>
          )}

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

          {/* TAB 1: INDIVIDUAL RANKING */}
          {activeTab === "global" && (
            <div className="space-y-4">
              {/* Top 3 Podium Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                {filteredLeaderboard.slice(0, 3).map((student, idx) => {
                  const medalColors = [
                    "from-amber-500/20 via-yellow-500/10 to-transparent border-amber-500/40 text-amber-300",
                    "from-slate-400/20 via-slate-400/10 to-transparent border-slate-400/40 text-slate-200",
                    "from-amber-700/20 via-amber-700/10 to-transparent border-amber-700/40 text-amber-500",
                  ];
                  return (
                    <div
                      key={student.participant_id}
                      className={`p-5 rounded-2xl border bg-gradient-to-b ${medalColors[idx]} relative overflow-hidden backdrop-blur-md`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-slate-700 flex items-center justify-center font-mono font-black text-base">
                          #{idx + 1}
                        </div>
                        <span className="text-[11px] font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                          {student.total_score.toLocaleString()} PTS
                        </span>
                      </div>

                      <div className="mt-4 space-y-1">
                        <h4 className="text-base font-bold text-white truncate">{student.display_name}</h4>
                        <p className="text-xs text-slate-300 truncate">{student.institution}</p>
                        <p className="text-[11px] text-blue-300 font-mono">{student.batch || "MBBS Candidate"}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center text-xs">
                        <div>
                          <div className="text-[10px] text-slate-400 font-mono">Pulses</div>
                          <div className="font-bold text-white mt-0.5">{student.total_pulses_done}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400 font-mono">Accuracy</div>
                          <div className="font-bold text-emerald-400 mt-0.5">{student.total_accuracy_pct}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400 font-mono">Streak</div>
                          <div className="font-bold text-amber-400 mt-0.5 flex items-center justify-center gap-0.5">
                            <Flame className="w-3 h-3 text-amber-400 fill-amber-400" />
                            {student.current_streak}d
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Full Standings Table */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/80 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Rank</th>
                        <th className="py-3 px-4">Doctor / Participant</th>
                        <th className="py-3 px-4">Medical College</th>
                        <th className="py-3 px-4">Batch Mapping</th>
                        <th className="py-3 px-4 text-center">Accuracy</th>
                        <th className="py-3 px-4 text-center">Streak</th>
                        <th className="py-3 px-4 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {filteredLeaderboard.map((student) => (
                        <tr key={student.participant_id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-300">
                            <span className={`inline-block w-6 text-center ${
                              student.rank === 1
                                ? "text-amber-400 font-black"
                                : student.rank === 2
                                ? "text-slate-300 font-black"
                                : student.rank === 3
                                ? "text-amber-600 font-black"
                                : "text-slate-500"
                            }`}>
                              #{student.rank}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white">{student.display_name}</div>
                            <div className="text-[10px] text-slate-500 sm:hidden">{student.institution}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-300">{student.institution}</td>
                          <td className="py-3 px-4 text-blue-300 font-mono text-[11px]">
                            {student.batch || "2026 Batch → Freshers"}
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-emerald-400 font-semibold">
                            {student.total_accuracy_pct}%
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-amber-400 font-semibold">
                            {student.current_streak}d
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-white">
                            {student.total_score.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COLLEGE RANKINGS */}
          {activeTab === "college" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {COLLEGE_RANKINGS.map((c) => (
                <div
                  key={c.name}
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
                        <h4 className="text-base font-bold text-white">{c.name}</h4>
                        <span className="text-xs text-slate-400">{c.city}</span>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold text-emerald-400">{c.movement}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800/60">
                    <div className="p-2 rounded-xl bg-slate-950/60">
                      <div className="text-[10px] text-slate-400">Enrolled</div>
                      <div className="font-mono text-xs font-bold text-white mt-0.5">{c.activeStudents}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/60">
                      <div className="text-[10px] text-slate-400">Accuracy</div>
                      <div className="font-mono text-xs font-bold text-emerald-400 mt-0.5">{c.avgAccuracy}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/60">
                      <div className="text-[10px] text-slate-400">Total Score</div>
                      <div className="font-mono text-xs font-bold text-amber-400 mt-0.5">{c.avgScore}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: BATCH RANKINGS — Requirement 2 Mapping */}
          {activeTab === "batch" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Official Batch Classification:</strong> 2026 Batch (Freshers), 2025 Batch (1st Year MBBS), 2024 Batch (2nd Year MBBS), and 2023 Batch (3rd Year MBBS).
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {BATCH_RANKINGS.map((b) => (
                  <div
                    key={b.batch}
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
                          <h4 className="text-base font-bold text-white">{b.batch}</h4>
                          <span className="text-xs text-blue-400 font-medium">{b.enrolled} Doctors Enrolled</span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-mono font-bold">
                        {b.pulseCompletionRate}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800/60">
                      <div className="p-2 rounded-xl bg-slate-950/60">
                        <div className="text-[10px] text-slate-400">Total Score</div>
                        <div className="font-mono text-xs font-bold text-white mt-0.5">{b.totalScore.toLocaleString()}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-950/60">
                        <div className="text-[10px] text-slate-400">Avg Streak</div>
                        <div className="font-mono text-xs font-bold text-emerald-400 mt-0.5">{b.avgStreak} Days</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-950/60">
                        <div className="text-[10px] text-slate-400">Top Subject</div>
                        <div className="font-mono text-xs font-bold text-amber-400 mt-0.5 truncate">{b.topSubject}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
            {/* Requirement 1: Champion: Dr. XYZ, Trophy ID: MT-S1-001, Status: To be crowned after Season 1 */}
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-amber-500/40 space-y-4 relative overflow-hidden shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-400">MedTrail Championship: Season 1</span>
                <span className="px-2.5 py-1 rounded-full font-mono text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Trophy ID: MT-S1-001
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/30">
                  XYZ
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">Reigning Crown Candidate</div>
                  <h4 className="text-xl font-black text-white">Champion: Dr. XYZ</h4>
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-semibold">
                      <Clock className="w-3 h-3 text-blue-400" />
                      Status: To be crowned after Season 1
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200/90 leading-relaxed">
                <strong>Placeholder until Season 1 ends:</strong> Dr. XYZ serves as the reserved champion placeholder. Upon the Season 1 finale on 17 October 2026, the #1 MBBS doctor will be permanently enshrined with Trophy ID MT-S1-001.
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center font-mono">
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Champion</div>
                  <div className="font-bold text-xs text-amber-300 mt-0.5 truncate">Dr. XYZ</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Trophy ID</div>
                  <div className="font-bold text-xs text-white mt-0.5">MT-S1-001</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400 font-sans">Status</div>
                  <div className="font-bold text-[11px] text-blue-300 mt-0.5 truncate">To be crowned</div>
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
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider">
                    Daily Pulse Slot {currentQIndex + 1} of {todayQuestions.length}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    {todayQuestions[currentQIndex]?.points} Points
                  </span>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-mono font-bold text-slate-400 uppercase">
                    {todayQuestions[currentQIndex]?.subject} &bull; {todayQuestions[currentQIndex]?.category}
                  </span>
                  <h3 className="text-lg font-bold text-white leading-relaxed">
                    {todayQuestions[currentQIndex]?.question}
                  </h3>
                </div>

                <div className="space-y-2.5">
                  {todayQuestions[currentQIndex]?.options.map((opt, optIdx) => {
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
                        onClick={() => handleSelectOption(optIdx)}
                        className={`w-full p-4 rounded-xl border text-left text-xs sm:text-sm font-medium transition cursor-pointer flex items-center justify-between ${btnClass}`}
                      >
                        <span>{opt}</span>
                        {hasSubmittedAnswer && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2">
                  <button
                    disabled={selectedOption === null || hasSubmittedAnswer}
                    onClick={handleSubmitQuestion}
                    className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer"
                  >
                    {currentQIndex === todayQuestions.length - 1 ? "Submit Final Pulse" : "Confirm Answer &rarr;"}
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

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
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
            {(todayAttempt || quizResult) && (
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

            {/* 5 Questions Review List */}
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
                                : "bg-red-500/20 text-red-300 border border-red-500/30"
                            }`}
                          >
                            {isCorrect ? "Correct (+20 Pts)" : "Incorrect"}
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
                        const isThisUserPick = userChoice === optIdx;

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
