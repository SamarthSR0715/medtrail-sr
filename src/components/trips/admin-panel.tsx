import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Search,
  Download,
  RefreshCw,
  Trash2,
  Phone,
  ShieldCheck,
  CheckCircle,
  Clock,
  XCircle,
  IndianRupee,
  ExternalLink,
  Filter,
} from "lucide-react";
import {
  fetchTripRegistrations,
  updateRegistrationStatus,
  deleteRegistration,
  exportRegistrationsToCSV,
  RAJGAD_TRIP,
  type TripRegistration,
} from "@/lib/trip-service";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AdminPanel() {
  const [registrations, setRegistrations] = useState<TripRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTripRegistrations(RAJGAD_TRIP.id);
      setRegistrations(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load registrations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Status update handler
  async function handleStatusChange(id: string, newStatus: string) {
    setUpdatingId(id);
    try {
      const res = await updateRegistrationStatus(id, newStatus);
      if (res.success) {
        setRegistrations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)),
        );
        toast.success(`Updated status to "${newStatus}"`);
      } else {
        toast.error(res.error || "Failed to update status.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error updating status.");
    } finally {
      setUpdatingId(null);
    }
  }

  // Delete handler
  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete registration for ${name}?`)) {
      return;
    }
    try {
      const res = await deleteRegistration(id);
      if (res.success) {
        setRegistrations((prev) => prev.filter((r) => r.id !== id));
        toast.success(`Deleted registration for ${name}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete.");
    }
  }

  // Filtered registrations
  const filtered = useMemo(() => {
    return registrations.filter((r) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.full_name.toLowerCase().includes(q) ||
        r.whatsapp.toLowerCase().includes(q) ||
        r.mbbs_year.toLowerCase().includes(q) ||
        r.emergency_contact.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" || r.status.toLowerCase() === statusFilter.toLowerCase();

      const matchesYear =
        yearFilter === "all" || r.mbbs_year.toLowerCase() === yearFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesYear;
    });
  }, [registrations, search, statusFilter, yearFilter]);

  // Overview metrics
  const activeRegistrations = registrations.filter((r) => r.status !== "cancelled");
  const paidCount = registrations.filter((r) => r.status === "paid" || r.status === "confirmed").length;
  const pendingCount = registrations.filter((r) => r.status === "registered" || r.status === "pending").length;
  const cancelledCount = registrations.filter((r) => r.status === "cancelled").length;
  const totalRevenue = paidCount * RAJGAD_TRIP.price;
  const remainingSeats = Math.max(0, RAJGAD_TRIP.totalSeats - activeRegistrations.length);

  return (
    <div className="space-y-8">
      {/* Top Banner / Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <ShieldCheck className="size-3.5" /> MedTrail Admin
            </span>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
              {RAJGAD_TRIP.tripNumber}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl font-display">
            {RAJGAD_TRIP.title} Registrations
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Manage student registrations, mark UPI payments, search attendees, and export CSV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="glass inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-transform hover:scale-105 cursor-pointer"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => exportRegistrationsToCSV(registrations)}
            className="bg-gradient-brand inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105 cursor-pointer"
          >
            <Download className="size-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs uppercase tracking-wider font-semibold">Total Reg</span>
            <Users className="size-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold font-display">{registrations.length}</p>
          <span className="text-[0.7rem] text-muted-foreground">
            {activeRegistrations.length} active
          </span>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs uppercase tracking-wider font-semibold">Paid / Confirmed</span>
            <CheckCircle className="size-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-display text-emerald-600 dark:text-emerald-400">
            {paidCount}
          </p>
          <span className="text-[0.7rem] text-muted-foreground">Seats secured</span>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs uppercase tracking-wider font-semibold">Pending</span>
            <Clock className="size-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-display text-amber-600 dark:text-amber-400">
            {pendingCount}
          </p>
          <span className="text-[0.7rem] text-muted-foreground">Awaiting payment</span>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs uppercase tracking-wider font-semibold">Seats Left</span>
            <ShieldCheck className="size-4 text-primary" />
          </div>
          <p
            className={cn(
              "mt-2 text-2xl font-bold font-display",
              remainingSeats === 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {remainingSeats} / 17
          </p>
          <span className="text-[0.7rem] text-muted-foreground">
            {remainingSeats === 0 ? "Sold Out" : "Available"}
          </span>
        </div>

        <div className="glass col-span-2 sm:col-span-1 rounded-2xl p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs uppercase tracking-wider font-semibold">Revenue</span>
            <IndianRupee className="size-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold font-display text-emerald-600 dark:text-emerald-400">
            ₹{totalRevenue.toLocaleString("en-IN")}
          </p>
          <span className="text-[0.7rem] text-muted-foreground">₹849 / seat</span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="glass flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by student name, WhatsApp, year, emergency contact..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card/60 pl-10 pr-4 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1 text-xs">
            <Filter className="size-3.5 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-input bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Statuses ({registrations.length})</option>
              <option value="registered">Registered / Pending ({pendingCount})</option>
              <option value="paid">Paid ({paidCount})</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled ({cancelledCount})</option>
            </select>
          </div>

          {/* MBBS Year Filter */}
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-lg border border-input bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All MBBS Years</option>
            <option value="1st Year MBBS">1st Year MBBS</option>
            <option value="2nd Year MBBS">2nd Year MBBS</option>
            <option value="3rd Year (Part 1)">3rd Year (Part 1)</option>
            <option value="Final Year MBBS">Final Year MBBS</option>
            <option value="Intern / House Surgeon">Intern / House Surgeon</option>
            <option value="Doctor / Resident">Doctor / Resident</option>
          </select>
        </div>
      </div>

      {/* Registrations List / Table */}
      <div className="glass overflow-hidden rounded-3xl border border-border/80">
        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            <RefreshCw className="mx-auto size-7 animate-spin text-primary" />
            <p className="mt-3 text-sm">Loading registrations...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Users className="mx-auto size-10 opacity-40" />
            <p className="mt-3 text-base font-semibold text-foreground">No registrations found</p>
            <p className="mt-1 text-xs">
              {search || statusFilter !== "all" || yearFilter !== "all"
                ? "Try adjusting your search query or status filter."
                : "No student registrations have been submitted yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-border/60 bg-secondary/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5">Student</th>
                  <th className="px-4 py-3.5">WhatsApp</th>
                  <th className="px-4 py-3.5">Year & Gender</th>
                  <th className="px-4 py-3.5">Emergency Contact</th>
                  <th className="px-4 py-3.5">Payment / Status</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((item, idx) => {
                  const isPaid = item.status === "paid" || item.status === "confirmed";
                  const isCancelled = item.status === "cancelled";
                  const cleanPhone = item.whatsapp.replace(/\D/g, "");

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors hover:bg-secondary/30",
                        isCancelled && "opacity-60",
                      )}
                    >
                      {/* Name & ID */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-semibold text-muted-foreground">
                            {idx + 1}
                          </span>
                          <div>
                            <p className="font-semibold text-foreground">{item.full_name}</p>
                            <p className="font-mono text-[0.65rem] text-muted-foreground">
                              {new Date(item.created_at).toLocaleDateString("en-IN", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* WhatsApp with click to chat */}
                      <td className="px-4 py-3.5">
                        <a
                          href={`https://wa.me/91${cleanPhone}?text=Hi%20${encodeURIComponent(item.full_name)},%20this%20is%20regarding%20your%20MedTrail%20Trip%20to%20Rajgad%20Fort!`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                        >
                          <Phone className="size-3.5 text-emerald-500" />
                          <span>{item.whatsapp}</span>
                          <ExternalLink className="size-3 opacity-60" />
                        </a>
                      </td>

                      {/* MBBS Year & Gender */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-medium text-foreground">
                          {item.mbbs_year}
                        </span>
                        <span className="ml-1.5 text-xs text-muted-foreground">· {item.gender}</span>
                      </td>

                      {/* Emergency Contact with click to call */}
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-medium text-foreground">{item.emergency_contact}</p>
                      </td>

                      {/* Status Dropdown */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={item.status}
                            disabled={updatingId === item.id}
                            onChange={(e) => handleStatusChange(item.id, e.target.value)}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all focus:outline-none focus:ring-1",
                              isPaid
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : isCancelled
                                  ? "border-destructive/30 bg-destructive/15 text-destructive"
                                  : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
                            )}
                          >
                            <option value="registered">Registered (Pending)</option>
                            <option value="paid">Paid (₹849)</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id, item.full_name)}
                          title="Delete registration"
                          className="glass inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
