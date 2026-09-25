import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Trophy,
  Bell,
  Download,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Flame,
  Award,
  Calendar,
  Building,
  GraduationCap,
  Send,
  Lock,
  Unlock,
  AlertTriangle,
  MapPin,
  ExternalLink,
  ChevronRight,
  UserCheck,
  UserX,
  FileSpreadsheet,
  Check,
  Eye,
  LogOut,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PulseStudio } from "@/components/admin/pulse-studio";
import { AdminPanel } from "@/components/trips/admin-panel";
import { sendRealFCMPush, requestAndRegisterNotificationPermission, detectDevicePlatform } from "@/lib/fcm-client";
import {
  SUPER_ADMIN_EMAIL,
  fetchSuperAdminDashboardStats,
  fetchAllRegistrations,
  updateRegistrationApproval,
  deleteRegistrationRecord,
  exportRegistrationsToCSV,
  getLeaderboardRankingsData,
  toggleLeaderboardFreeze,
  declareSuperAdminFinalResults,
  fetchAllNotifications,
  createPushNotification,
  cancelOrDeleteNotification,
  fetchHallOfFameRecord,
  updateHallOfFameRecord,
  type SuperAdminDashboardStats,
  type ChampionshipRegistrationRow,
  type IndividualRankItem,
  type CollegeRankItem,
  type BatchRankItem,
  type NotificationRecord,
  type HallOfFameData,
  DEFAULT_HALL_OF_FAME,
} from "@/lib/super-admin-service";
import { fetchLiveOpsState } from "@/lib/pulse-admin-service";
import { supabase } from "@/integrations/supabase/client";

export function SuperAdminControlCenter() {
  const { user, signOut } = useAuth();

  // Top Section Tab
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "pulse_studio" | "registrations" | "leaderboard" | "notifications" | "hall_of_fame" | "trips"
  >("dashboard");

  // ── 1. Dashboard State ──────────────────────────────────────────────────────
  const [stats, setStats] = useState<SuperAdminDashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const loadStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const data = await fetchSuperAdminDashboardStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to load dashboard stats:", err);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, [loadStats]);

  // ── 2. Registration Manager State ───────────────────────────────────────────
  const [registrations, setRegistrations] = useState<ChampionshipRegistrationRow[]>([]);
  const [isLoadingRegs, setIsLoadingRegs] = useState(false);
  const [regSearch, setRegSearch] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "removed">("all");

  const loadRegistrations = useCallback(async () => {
    setIsLoadingRegs(true);
    try {
      const data = await fetchAllRegistrations();
      setRegistrations(data);
    } catch (err) {
      console.error("Failed to load registrations:", err);
    } finally {
      setIsLoadingRegs(false);
    }
  }, []);

  useEffect(() => {
    loadRegistrations();

    // Supabase Realtime subscription for instant roster updates
    const channel = supabase
      .channel("admin_registrations_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "championship_registrations" },
        () => {
          loadRegistrations();
          loadStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRegistrations, loadStats]);

  // Distinct colleges for filter
  const distinctColleges = useMemo(() => {
    const set = new Set<string>();
    registrations.forEach((r) => {
      if (r.medical_college) set.add(r.medical_college.trim());
    });
    return Array.from(set).sort();
  }, [registrations]);

  // Distinct batches for filter
  const distinctBatches = useMemo(() => {
    const set = new Set<string>();
    registrations.forEach((r) => {
      if (r.batch) set.add(r.batch.trim());
    });
    return Array.from(set).sort();
  }, [registrations]);

  // Filtered registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((r) => {
      const q = regSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.passport_id && r.passport_id.toLowerCase().includes(q)) ||
        r.medical_college.toLowerCase().includes(q);

      const matchCollege = collegeFilter === "all" || r.medical_college === collegeFilter;
      const matchBatch = batchFilter === "all" || r.batch === batchFilter;
      const matchStatus = statusFilter === "all" || r.approval_status === statusFilter;

      return matchSearch && matchCollege && matchBatch && matchStatus;
    });
  }, [registrations, regSearch, collegeFilter, batchFilter, statusFilter]);

  const handleApprove = async (id: string) => {
    const res = await updateRegistrationApproval(id, "approved");
    if (res.success) {
      toast.success("Registration marked as Approved");
      loadRegistrations();
      loadStats();
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove ${name}'s championship registration?`)) {
      const res = await updateRegistrationApproval(id, "removed");
      if (res.success) {
        toast.info(`Registration for ${name} removed`);
        loadRegistrations();
        loadStats();
      }
    }
  };

  const handleDeletePermanent = async (id: string) => {
    if (window.confirm("Permanently delete this registration row from database?")) {
      const res = await deleteRegistrationRecord(id);
      if (res.success) {
        toast.success("Registration permanently deleted");
        loadRegistrations();
        loadStats();
      }
    }
  };

  // ── 3. Live Leaderboard Control State ────────────────────────────────────────
  const [leaderboardTab, setLeaderboardTab] = useState<"individual" | "college" | "batch">("individual");
  const [isLeaderboardFrozen, setIsLeaderboardFrozen] = useState(false);
  const [isResultsDeclared, setIsResultsDeclared] = useState(false);
  const [rankingsData, setRankingsData] = useState(() => getLeaderboardRankingsData());
  const [showDeclareConfirmModal, setShowDeclareConfirmModal] = useState(false);
  const [declareConfirmText, setDeclareConfirmText] = useState("");
  const [isDeclaring, setIsDeclaring] = useState(false);

  const loadLeaderboardLiveOps = useCallback(async () => {
    try {
      const ops = await fetchLiveOpsState();
      setIsLeaderboardFrozen(ops.is_leaderboard_frozen);
      setIsResultsDeclared(ops.results_declared);
      setRankingsData(getLeaderboardRankingsData());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadLeaderboardLiveOps();
  }, [loadLeaderboardLiveOps]);

  const handleToggleFreeze = async () => {
    const nextState = !isLeaderboardFrozen;
    const res = await toggleLeaderboardFreeze(nextState);
    setIsLeaderboardFrozen(res);
    toast.success(res ? "Leaderboard successfully FROZEN" : "Leaderboard UNFREEZED and live");
  };

  const handleExecuteDeclareResults = async () => {
    if (declareConfirmText.trim().toUpperCase() !== "CONFIRM") {
      toast.error("Please type 'CONFIRM' to finalize results.");
      return;
    }
    setIsDeclaring(true);
    try {
      const res = await declareSuperAdminFinalResults();
      if (res.success) {
        setIsResultsDeclared(true);
        setIsLeaderboardFrozen(true);
        setShowDeclareConfirmModal(false);
        setDeclareConfirmText("");
        toast.success(`Final Results Declared! Champion: ${res.championName}`);
        loadStats();
        loadHallOfFame();
      }
    } catch (err: any) {
      toast.error("Failed to declare results: " + err.message);
    } finally {
      setIsDeclaring(false);
    }
  };

  // ── 4. Notification Center State ─────────────────────────────────────────────
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isLoadingNotifs, setIsLoadingNotifs] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifEmoji, setNotifEmoji] = useState("⚡");
  const [notifAudience, setNotifAudience] = useState<"all" | "championship" | "college" | "batch" | "individual">("all");
  const [notifAudienceTarget, setNotifAudienceTarget] = useState("");
  const [notifDeepLink, setNotifDeepLink] = useState<string>("/championship");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [isSendingNotif, setIsSendingNotif] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [deviceStats, setDeviceStats] = useState<{ total: number; android: number; ios: number; web: number }>({
    total: 0,
    android: 0,
    ios: 0,
    web: 0,
  });

  const loadNotifications = useCallback(async () => {
    setIsLoadingNotifs(true);
    try {
      const data = await fetchAllNotifications();
      setNotifications(data);
    } finally {
      setIsLoadingNotifs(false);
    }
  }, []);

  const loadDeviceStats = useCallback(async () => {
    try {
      const { data } = await supabase.from("device_tokens").select("platform").eq("is_active", true);
      const list = data || [];
      setDeviceStats({
        total: list.length,
        android: list.filter((d: any) => d.platform === "android").length,
        ios: list.filter((d: any) => d.platform === "ios").length,
        web: list.filter((d: any) => d.platform === "web").length,
      });
    } catch (err) {
      console.warn("[ControlCenter] Device stats notice:", err);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    loadDeviceStats();
  }, [loadNotifications, loadDeviceStats]);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) {
      toast.error("Notification Title and Message are required.");
      return;
    }

    if (isScheduled && !scheduledDateTime) {
      toast.error("Please select a date and time for the scheduled broadcast.");
      return;
    }

    setIsSendingNotif(true);
    try {
      await createPushNotification({
        title: notifTitle,
        message: notifMessage,
        emoji: notifEmoji,
        audience_type: notifAudience,
        audience_target: notifAudienceTarget.trim() || null,
        isScheduled,
        scheduledFor: isScheduled ? scheduledDateTime : null,
      });

      // Requirement 4 & 6: Deliver real FCM push notification to devices with deep link
      if (!isScheduled) {
        const fcmRes = await sendRealFCMPush({
          title: `${notifEmoji} ${notifTitle}`,
          body: notifMessage,
          deepLink: notifDeepLink,
          audience_type: notifAudience,
          audience_target: notifAudienceTarget.trim() || null,
        });

        if (fcmRes.success) {
          toast.success(fcmRes.message || "Push notification broadcasted to all users' phones!");
        }
      } else {
        toast.success("Notification Scheduled for future broadcast.");
      }

      setNotifTitle("");
      setNotifMessage("");
      setIsScheduled(false);
      setScheduledDateTime("");
      loadNotifications();
      loadDeviceStats();
    } catch (err: any) {
      toast.error("Failed to send notification: " + err.message);
    } finally {
      setIsSendingNotif(false);
    }
  };

  const handleTestPushOnDevice = async () => {
    setIsTestingPush(true);
    try {
      const reg = await requestAndRegisterNotificationPermission(user || undefined);
      if (!reg.success) {
        toast.error(reg.error || "Notification permission denied or blocked in browser settings.");
        return;
      }

      toast.success("📱 Device registered! Delivering instant test push...");
      const fcmRes = await sendRealFCMPush({
        title: "⚡ MedTrail FCM Test Notification",
        body: "Real-time push delivery confirmed on your phone! Deep linking to /championship.",
        type: "pulse",
        deepLink: "/championship",
        audience_type: "individual",
        audience_target: user?.id,
      });

      if (fcmRes.success) {
        toast.success("Push delivered to device!");
      }
      loadDeviceStats();
    } catch (err: any) {
      toast.error(err?.message || "Failed to trigger test notification.");
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleDeleteNotif = async (id: string) => {
    await cancelOrDeleteNotification(id);
    toast.info("Notification removed from history");
    loadNotifications();
  };

  // ── 5. Hall of Fame Manager State ───────────────────────────────────────────
  const [hof, setHof] = useState<HallOfFameData>(DEFAULT_HALL_OF_FAME);
  const [isLoadingHof, setIsLoadingHof] = useState(false);
  const [isSavingHof, setIsSavingHof] = useState(false);

  const loadHallOfFame = useCallback(async () => {
    setIsLoadingHof(true);
    try {
      const data = await fetchHallOfFameRecord();
      setHof(data);
    } finally {
      setIsLoadingHof(false);
    }
  }, []);

  useEffect(() => {
    loadHallOfFame();
  }, [loadHallOfFame]);

  const handleSaveHallOfFame = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingHof(true);
    try {
      const updated = await updateHallOfFameRecord({
        champion_name: hof.champion_name,
        college: hof.college,
        trophy_id: hof.trophy_id,
        season_title: hof.season_title,
        batch: hof.batch,
        winner_photo: hof.winner_photo,
        status: hof.status,
        final_score: hof.final_score,
        accuracy_pct: hof.accuracy_pct,
        streak_days: hof.streak_days,
      });
      setHof(updated);
      toast.success("Hall of Fame Updated! Public Championship page updated in real time.");
    } catch (err: any) {
      toast.error("Failed to update Hall of Fame: " + err.message);
    } finally {
      setIsSavingHof(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* ── TOP HERO HEADER & IDENTITY ── */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-950 via-[#0B0F19] to-slate-950 p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-16 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-bold tracking-wider uppercase">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                Super Admin Authorized
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[11px] font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                Realtime Active
              </span>
              <span className="font-mono text-xs text-slate-400">
                Logged in: <strong className="text-slate-200">{SUPER_ADMIN_EMAIL}</strong>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
              MedTrail Control Center
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              Official command headquarters for the MedTrail Championship: live pulse curation, participant roster management, synchronized leaderboards, and instant push broadcasting.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/championship"
              target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-bold transition shadow-lg"
            >
              <span>Student View</span>
              <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
            </Link>

            <button
              onClick={() => {
                loadStats();
                loadRegistrations();
                loadNotifications();
                loadHallOfFame();
                toast.success("Control Center telemetry refreshed");
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-500/25 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Telemetry</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-4">
          {[
            { id: "dashboard", label: "Dashboard", icon: Sparkles },
            { id: "pulse_studio", label: "Pulse Studio", icon: Flame },
            { id: "registrations", label: `Registrations (${registrations.length})`, icon: Users },
            { id: "leaderboard", label: "Leaderboard Control", icon: Trophy },
            { id: "notifications", label: "Notification Center", icon: Bell },
            { id: "hall_of_fame", label: "Hall of Fame", icon: Award },
            { id: "trips", label: "Trip Admin", icon: MapPin },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                  isActive
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30"
                    : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TAB 1: DASHBOARD (LIVE STATISTICS) ── */}
      {activeTab === "dashboard" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-white">Championship Live Telemetry</h2>
              <p className="text-xs text-slate-400">
                Real-time synchronized data from Supabase backend. Auto-refreshes every 10 seconds.
              </p>
            </div>
            {stats && (
              <span className="font-mono text-xs text-slate-400">
                Last updated: <strong className="text-amber-400">{stats.lastUpdated}</strong>
              </span>
            )}
          </div>

          {/* 7 Core Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Users */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                  Total Users
                </span>
                <span className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  <Users className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-white font-mono">
                  {isLoadingStats ? "..." : (stats?.totalUsers ?? 0).toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Platform user profiles & active sessions</div>
              </div>
            </div>

            {/* Card 2: Registered Championship */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-amber-500/30 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
                  Registered Participants
                </span>
                <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Award className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-amber-300 font-mono">
                  {isLoadingStats ? "..." : (stats?.registeredChampionship ?? 0).toLocaleString()}
                </div>
                <div className="text-[11px] text-amber-400/80 mt-1">Verified Season 1 Doctor Passports</div>
              </div>
            </div>

            {/* Card 3: Online Users */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-emerald-500/30 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                  Online Right Now
                </span>
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Flame className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-emerald-300 font-mono flex items-center gap-2">
                  <span>{isLoadingStats ? "..." : stats?.onlineUsers ?? 0}</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-[11px] text-emerald-400/80 mt-1">Active live participants connected</div>
              </div>
            </div>

            {/* Card 4: Total Colleges */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                  Total Colleges
                </span>
                <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  <Building className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-white font-mono">
                  {isLoadingStats ? "..." : stats?.totalColleges ?? 0}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Participating medical institutions</div>
              </div>
            </div>

            {/* Card 5: Today's Pulse Status */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                  Today's Pulse
                </span>
                <span className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  <Clock className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-black uppercase font-mono">
                  {stats?.todayPulseStatus === "live" && <span className="text-emerald-400">LIVE NOW</span>}
                  {stats?.todayPulseStatus === "published" && <span className="text-blue-400">PUBLISHED</span>}
                  {stats?.todayPulseStatus === "draft" && <span className="text-amber-400">DRAFT</span>}
                  {stats?.todayPulseStatus === "paused" && <span className="text-yellow-400">PAUSED</span>}
                  {stats?.todayPulseStatus === "ended" && <span className="text-slate-400">CONCLUDED</span>}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Manual admin control state</div>
              </div>
            </div>

            {/* Card 6: Current Championship Day */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md relative overflow-hidden shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                  Season 1 Timeline
                </span>
                <span className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <Calendar className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-cyan-300 font-mono">
                  Day {isLoadingStats ? "1" : stats?.currentChampionshipDay ?? 1}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">21-Day MBBS Championship cycle</div>
              </div>
            </div>

            {/* Card 7: Total Pulses Completed */}
            <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md relative overflow-hidden shadow-xl sm:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                  Total Pulses Completed
                </span>
                <span className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-3">
                <div className="text-3xl font-black text-white font-mono">
                  {isLoadingStats ? "..." : (stats?.totalPulsesCompleted ?? 0).toLocaleString()}
                </div>
                <div className="text-xs text-slate-400">5-question clinical assessments submitted</div>
              </div>
            </div>
          </div>

          {/* Quick Actions Shortcuts */}
          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Quick Administrative Directives
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setActiveTab("pulse_studio")}
                className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 text-left transition cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                  <span>Open Pulse Studio</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
                <p className="text-xs text-slate-400">Curate today's 5 questions or toggle Go LIVE</p>
              </button>

              <button
                onClick={() => setActiveTab("registrations")}
                className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 text-left transition cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-bold text-blue-400">
                  <span>Manage Registrations</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
                <p className="text-xs text-slate-400">Approve, remove, or export CSV roster</p>
              </button>

              <button
                onClick={() => setActiveTab("notifications")}
                className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-purple-500/50 text-left transition cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between text-xs font-bold text-purple-400">
                  <span>Broadcast Notification</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
                <p className="text-xs text-slate-400">Send instant push alert to active students</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: PULSE STUDIO ── */}
      {activeTab === "pulse_studio" && (
        <div className="space-y-4">
          <PulseStudio />
        </div>
      )}

      {/* ── TAB 3: REGISTRATION MANAGER ── */}
      {activeTab === "registrations" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-white">Championship Registration Manager</h2>
                <span className="px-3 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold">
                  {registrations.length} Enrolled
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Real-time records from <code className="text-amber-300">public.championship_registrations</code>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => exportRegistrationsToCSV(filteredRegistrations)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV ({filteredRegistrations.length})</span>
              </button>

              <button
                onClick={loadRegistrations}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                title="Refresh registrations"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingRegs ? "animate-spin text-amber-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={regSearch}
                onChange={(e) => setRegSearch(e.target.value)}
                placeholder="Search by name, email, passport ID, or college..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={collegeFilter}
                onChange={(e) => setCollegeFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="all">All Colleges ({distinctColleges.length})</option>
                {distinctColleges.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="all">All Batches</option>
                {distinctBatches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="all">All Statuses</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="removed">Removed</option>
              </select>
            </div>
          </div>

          {/* Registrations Table */}
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Doctor / Participant</th>
                    <th className="py-3 px-4">Medical College</th>
                    <th className="py-3 px-4">Batch</th>
                    <th className="py-3 px-4">Passport ID</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Registered</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredRegistrations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        No registrations matching current search or filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRegistrations.map((reg) => (
                      <tr key={reg.id} className="hover:bg-slate-900/40 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{reg.full_name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{reg.email}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 max-w-[200px] truncate" title={reg.medical_college}>
                          {reg.medical_college}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">
                          {reg.batch}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px]">
                          {reg.passport_id ? (
                            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold">
                              {reg.passport_id}
                            </span>
                          ) : (
                            <span className="text-slate-500">None</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {reg.approval_status === "approved" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[10px] font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              Approved
                            </span>
                          )}
                          {reg.approval_status === "pending" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[10px] font-bold">
                              <Clock className="w-3 h-3 text-amber-400" />
                              Pending
                            </span>
                          )}
                          {reg.approval_status === "removed" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono text-[10px] font-bold">
                              <XCircle className="w-3 h-3 text-rose-400" />
                              Removed
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-[11px] text-slate-400 font-mono whitespace-nowrap">
                          {new Date(reg.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {reg.approval_status !== "approved" && (
                              <button
                                onClick={() => handleApprove(reg.id)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition cursor-pointer"
                                title="Approve registration"
                              >
                                Approve
                              </button>
                            )}
                            {reg.approval_status !== "removed" && (
                              <button
                                onClick={() => handleRemove(reg.id, reg.full_name)}
                                className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 text-[11px] font-bold transition cursor-pointer"
                                title="Remove registration"
                              >
                                Remove
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePermanent(reg.id)}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 text-[10px] font-mono transition cursor-pointer"
                              title="Delete permanently"
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 4: LIVE LEADERBOARD CONTROL ── */}
      {activeTab === "leaderboard" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-white">Live Leaderboard Control Deck</h2>
                {isLeaderboardFrozen ? (
                  <span className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold inline-flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-rose-400" />
                    FROZEN
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold inline-flex items-center gap-1.5">
                    <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                    LIVE STANDINGS
                  </span>
                )}
                {isResultsDeclared && (
                  <span className="px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold">
                    RESULTS DECLARED
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Synchronized scoring, institutional standings, and permanent result declaration.
              </p>
            </div>

            {/* Action Buttons: Refresh, Freeze, Declare Final Results */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={loadLeaderboardLiveOps}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-slate-800 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>

              <button
                onClick={handleToggleFreeze}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs border transition cursor-pointer ${
                  isLeaderboardFrozen
                    ? "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40"
                    : "bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border-yellow-500/40"
                }`}
              >
                {isLeaderboardFrozen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{isLeaderboardFrozen ? "Unfreeze Leaderboard" : "Freeze Leaderboard"}</span>
              </button>

              <button
                disabled={isResultsDeclared}
                onClick={() => setShowDeclareConfirmModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-500/30 cursor-pointer disabled:opacity-50"
              >
                <Trophy className="w-3.5 h-3.5 text-slate-950" />
                <span>{isResultsDeclared ? "Results Finalized" : "Declare Final Results"}</span>
              </button>
            </div>
          </div>

          {/* Subtabs: Individual, College, Batch */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            {[
              { id: "individual", label: "Individual Rankings", count: rankingsData.individuals.length },
              { id: "college", label: "College Rankings", count: rankingsData.collegeRankings.length },
              { id: "batch", label: "Batch Rankings", count: rankingsData.batchRankings.length },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setLeaderboardTab(st.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
                  leaderboardTab === st.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                    : "bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                <span>{st.label}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-950 text-[10px] font-mono">
                  {st.count}
                </span>
              </button>
            ))}
          </div>

          {/* Ranking View 1: Individual */}
          {leaderboardTab === "individual" && (
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">Participant Doctor</th>
                      <th className="py-3 px-4">Medical Institution</th>
                      <th className="py-3 px-4">Batch</th>
                      <th className="py-3 px-4">Accuracy</th>
                      <th className="py-3 px-4">Pulses</th>
                      <th className="py-3 px-4 text-right">Total Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {rankingsData.individuals.map((ind) => (
                      <tr key={ind.participantId} className="hover:bg-slate-900/40 transition">
                        <td className="py-3.5 px-4 font-mono font-bold">
                          {ind.rank === 1 && <span className="text-amber-400 font-black">🥇 #1</span>}
                          {ind.rank === 2 && <span className="text-slate-300 font-black">🥈 #2</span>}
                          {ind.rank === 3 && <span className="text-amber-600 font-black">🥉 #3</span>}
                          {ind.rank > 3 && <span className="text-slate-400">#{ind.rank}</span>}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{ind.name}</div>
                          <div className="text-[10px] text-amber-400/80 font-mono">Streak: {ind.streak} days</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 max-w-[200px] truncate">{ind.college}</td>
                        <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">{ind.batch}</td>
                        <td className="py-3.5 px-4 font-mono text-emerald-400 font-bold">{ind.accuracy}%</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{ind.pulsesDone}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300 text-sm">
                          {ind.totalScore.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ranking View 2: College */}
          {leaderboardTab === "college" && (
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">Medical College</th>
                      <th className="py-3 px-4">Enrolled Doctors</th>
                      <th className="py-3 px-4">Leading Scorer</th>
                      <th className="py-3 px-4">Average Score</th>
                      <th className="py-3 px-4 text-right">Combined Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {rankingsData.collegeRankings.map((col) => (
                      <tr key={col.collegeName} className="hover:bg-slate-900/40 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-amber-400">#{col.rank}</td>
                        <td className="py-3.5 px-4 font-bold text-white">{col.collegeName}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{col.participantsCount}</td>
                        <td className="py-3.5 px-4 text-blue-300 font-medium">{col.topScorer}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{col.avgScore.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300 text-sm">
                          {col.totalScore.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ranking View 3: Batch */}
          {leaderboardTab === "batch" && (
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Rank</th>
                      <th className="py-3 px-4">MBBS Batch Cohort</th>
                      <th className="py-3 px-4">Active Participants</th>
                      <th className="py-3 px-4">Cohort Average</th>
                      <th className="py-3 px-4 text-right">Aggregated Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {rankingsData.batchRankings.map((bat) => (
                      <tr key={bat.batchName} className="hover:bg-slate-900/40 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-amber-400">#{bat.rank}</td>
                        <td className="py-3.5 px-4 font-bold text-white">{bat.batchName}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{bat.participantsCount}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">{bat.avgScore.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-amber-300 text-sm">
                          {bat.totalScore.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 5: NOTIFICATION CENTER ── */}
      {activeTab === "notifications" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                  FCM v1 Engine &bull; Android + iOS
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-mono font-bold">
                  <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Delivery Ready
                </span>
              </div>
              <h2 className="text-xl font-black text-white mt-1">Push Notification Center</h2>
              <p className="text-xs text-slate-400">
                Broadcast instant push alerts to Android & iOS phones with deep link navigation via Firebase Cloud Messaging.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestPushOnDevice}
                disabled={isTestingPush}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 text-xs font-bold cursor-pointer transition disabled:opacity-50"
              >
                <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                <span>{isTestingPush ? "Testing Device..." : "Test Push on This Phone"}</span>
              </button>
              <button
                onClick={() => {
                  loadNotifications();
                  loadDeviceStats();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold cursor-pointer hover:text-white"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Registry</span>
              </button>
            </div>
          </div>

          {/* Real Device Registry Statistics Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl">
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Registered Phones</div>
              <div className="text-lg font-black font-mono text-white flex items-center gap-1.5">
                <Smartphone className="size-4 text-amber-400" />
                <span>{deviceStats.total}</span>
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Android Devices</div>
              <div className="text-lg font-black font-mono text-emerald-400">
                {deviceStats.android}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">iOS Devices</div>
              <div className="text-lg font-black font-mono text-blue-400">
                {deviceStats.ios}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Web / Desktop PWA</div>
              <div className="text-lg font-black font-mono text-purple-400">
                {deviceStats.web}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Composer (5 cols) */}
            <div className="lg:col-span-5 p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-400" />
                <span>Create Notification</span>
              </h3>

              <form onSubmit={handleSendNotification} className="space-y-4">
                {/* Emoji Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Emoji Icon</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {["⚡", "🏆", "🚀", "📢", "⏰", "🔥", "🩺", "🚨", "🎯"].map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setNotifEmoji(em)}
                        className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center transition cursor-pointer border ${
                          notifEmoji === em
                            ? "bg-amber-500/20 border-amber-500 scale-110 shadow-md"
                            : "bg-slate-950 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Notification Title</label>
                  <input
                    type="text"
                    required
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    placeholder="e.g. Daily Pulse Goes LIVE at 7:00 PM!"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Message Content</label>
                  <textarea
                    rows={3}
                    required
                    value={notifMessage}
                    onChange={(e) => setNotifMessage(e.target.value)}
                    placeholder="Enter message details seen by participants..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* Audience */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Target Audience</label>
                  <select
                    value={notifAudience}
                    onChange={(e) => setNotifAudience(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="all">All Users (Global)</option>
                    <option value="championship">Championship Participants Only</option>
                    <option value="college">Selected Medical College</option>
                    <option value="batch">Selected MBBS Batch</option>
                    <option value="individual">Individual User (Email / ID)</option>
                  </select>
                </div>

                {/* Conditional Audience Target Input */}
                {notifAudience === "college" && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono text-slate-400">Choose Medical College</label>
                    <select
                      value={notifAudienceTarget}
                      onChange={(e) => setNotifAudienceTarget(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Select college...</option>
                      {distinctColleges.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {notifAudience === "batch" && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono text-slate-400">Choose MBBS Batch</label>
                    <select
                      value={notifAudienceTarget}
                      onChange={(e) => setNotifAudienceTarget(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Select batch...</option>
                      {distinctBatches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {notifAudience === "individual" && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono text-slate-400">User Email Address</label>
                    <input
                      type="email"
                      value={notifAudienceTarget}
                      onChange={(e) => setNotifAudienceTarget(e.target.value)}
                      placeholder="student@medical.college.in"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {/* Requirement 6: Deep Link Route Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Deep Link Action (When Tapped on Phone)</label>
                  <select
                    value={notifDeepLink}
                    onChange={(e) => setNotifDeepLink(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="/championship">Pulse Live Page (/championship)</option>
                    <option value="/passport">Badge & Passport Vault (/passport)</option>
                    <option value="/championship#registration">Season 1 Registration (/championship#registration)</option>
                    <option value="/championship#hall-of-fame">Hall of Fame Standings (/championship#hall-of-fame)</option>
                    <option value="/notes">Clinical MBBS Notes (/notes)</option>
                  </select>
                </div>

                {/* Schedule Option Toggle */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="schedule_toggle"
                      checked={isScheduled}
                      onChange={(e) => setIsScheduled(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                    />
                    <label htmlFor="schedule_toggle" className="text-xs text-slate-300 font-medium cursor-pointer">
                      Schedule for Later
                    </label>
                  </div>
                </div>

                {isScheduled && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono text-slate-400">Broadcast Date & Time (IST)</label>
                    <input
                      type="datetime-local"
                      value={scheduledDateTime}
                      onChange={(e) => setScheduledDateTime(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={isSendingNotif}
                  className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSendingNotif ? "Broadcasting..." : isScheduled ? "Schedule Notification" : "Send Now (Live Broadcast)"}</span>
                </button>
              </form>
            </div>

            {/* Right: Broadcast History (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Broadcast History & Scheduled Queue
                </h3>
                <span className="font-mono text-xs text-slate-400">{notifications.length} logged</span>
              </div>

              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-500">
                    No notifications sent or scheduled yet.
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-lg shrink-0">
                          {notif.emoji || "📢"}
                        </span>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white">{notif.title}</h4>
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono text-slate-300">
                              {notif.audience_type}
                            </span>
                            {notif.status === "scheduled" ? (
                              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] font-mono font-bold">
                                Scheduled
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold">
                                Sent
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">{notif.message}</p>
                          <div className="text-[10px] font-mono text-slate-500">
                            {notif.sent_at ? `Sent: ${new Date(notif.sent_at).toLocaleString("en-IN")}` : `Scheduled: ${notif.scheduled_for}`}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteNotif(notif.id)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-rose-300 text-xs transition cursor-pointer"
                        title="Delete record"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: HALL OF FAME MANAGER ── */}
      {activeTab === "hall_of_fame" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-white">Hall of Fame Manager</h2>
              <p className="text-xs text-slate-400">
                Permanently update and inscribe the Season Champion into the official public Hall of Fame.
              </p>
            </div>
            <Link
              to="/championship"
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-amber-400 text-xs font-bold"
            >
              <span>Preview Public Hall of Fame</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Editor Form (7 cols) */}
            <form onSubmit={handleSaveHallOfFame} className="lg:col-span-7 p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Champion Enshrinement Details</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Champion Name</label>
                  <input
                    type="text"
                    required
                    value={hof.champion_name}
                    onChange={(e) => setHof({ ...hof, champion_name: e.target.value })}
                    placeholder="e.g. Dr. Samarth Rautrao"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Medical College</label>
                  <input
                    type="text"
                    required
                    value={hof.college}
                    onChange={(e) => setHof({ ...hof, college: e.target.value })}
                    placeholder="e.g. MIMER Medical College, Pune"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Trophy ID</label>
                  <input
                    type="text"
                    required
                    value={hof.trophy_id}
                    onChange={(e) => setHof({ ...hof, trophy_id: e.target.value })}
                    placeholder="MT-S1-001"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-amber-400 font-mono text-xs focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-slate-400">Season Title</label>
                  <input
                    type="text"
                    value={hof.season_title}
                    onChange={(e) => setHof({ ...hof, season_title: e.target.value })}
                    placeholder="MedTrail Championship: Season 1"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[11px] font-mono text-slate-400">Status / Inscription Annotation</label>
                  <input
                    type="text"
                    value={hof.status}
                    onChange={(e) => setHof({ ...hof, status: e.target.value })}
                    placeholder="e.g. Crowned Sovereign Champion or To be crowned after Season 1"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[11px] font-mono text-slate-400">Winner Photo URL (Optional)</label>
                  <input
                    type="text"
                    value={hof.winner_photo}
                    onChange={(e) => setHof({ ...hof, winner_photo: e.target.value })}
                    placeholder="https://... or leave empty to use initials avatar"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setHof(DEFAULT_HALL_OF_FAME)}
                  className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 text-xs font-bold transition cursor-pointer"
                >
                  Reset Defaults
                </button>

                <button
                  type="submit"
                  disabled={isSavingHof}
                  className="px-6 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/30 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSavingHof ? "Updating..." : "Save & Update Public Hall of Fame"}</span>
                </button>
              </div>
            </form>

            {/* Live Card Preview (5 cols) */}
            <div className="lg:col-span-5 space-y-3">
              <div className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Live Public Card Preview
              </div>

              <div className="p-6 rounded-3xl bg-slate-950 border border-amber-500/40 space-y-4 relative overflow-hidden shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-amber-400">{hof.season_title}</span>
                  <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Trophy ID: {hof.trophy_id}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  {hof.winner_photo ? (
                    <img
                      src={hof.winner_photo}
                      alt={hof.champion_name}
                      className="w-16 h-16 rounded-2xl object-cover border-2 border-amber-500 shadow-lg shadow-amber-500/30"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/30">
                      {hof.champion_name.slice(0, 3).toUpperCase()}
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                      Reigning Crown Candidate
                    </div>
                    <h4 className="text-xl font-black text-white">{hof.champion_name}</h4>
                    <div className="text-xs text-slate-300">{hof.college}</div>
                    <div className="pt-0.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-[11px] font-semibold">
                        <Clock className="w-3 h-3 text-blue-400" />
                        {hof.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center font-mono">
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-sans">Champion</div>
                    <div className="font-bold text-xs text-amber-300 mt-0.5 truncate">{hof.champion_name}</div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-sans">Trophy ID</div>
                    <div className="font-bold text-xs text-white mt-0.5 truncate">{hof.trophy_id}</div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-sans">Status</div>
                    <div className="font-bold text-[10px] text-blue-300 mt-0.5 truncate">{hof.status}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 7: TRIPS MANAGEMENT (EXISTING ADMIN PANEL PRESERVED) ── */}
      {activeTab === "trips" && (
        <div className="space-y-4">
          <AdminPanel />
        </div>
      )}

      {/* ── DECLARE RESULTS CONFIRMATION MODAL ── */}
      {showDeclareConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-amber-500/50 p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="p-3 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Trophy className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-lg font-black text-white">Declare Official Final Results?</h3>
                <p className="text-xs text-slate-400">Irreversible Season Finale action</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200/90 space-y-2 leading-relaxed">
              <p>
                <strong>Warning:</strong> Declaring final results will execute the following operations:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li>Permanently lock all further test and pulse submissions across all students.</li>
                <li>Freeze the live leaderboard in its current exact standings.</li>
                <li>Award official digital accolades and Championship badges automatically.</li>
                <li>Inscribe the Rank #1 doctor into the public Hall of Fame.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-slate-300">
                Type <strong className="text-amber-400">CONFIRM</strong> to authorize this declaration:
              </label>
              <input
                type="text"
                value={declareConfirmText}
                onChange={(e) => setDeclareConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeclareConfirmModal(false);
                  setDeclareConfirmText("");
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={declareConfirmText.trim().toUpperCase() !== "CONFIRM" || isDeclaring}
                onClick={handleExecuteDeclareResults}
                className="px-6 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer disabled:opacity-40"
              >
                {isDeclaring ? "Finalizing..." : "Declare & Seal Results"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
