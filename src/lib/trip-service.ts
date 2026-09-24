import { supabase } from "@/integrations/supabase/client";

export interface TripRegistration {
  id: string;
  created_at: string;
  full_name: string;
  whatsapp: string;
  mbbs_year: string;
  gender: string;
  emergency_contact: string;
  trip_id: string;
  status: "registered" | "confirmed" | "paid" | "cancelled" | string;
}

export type TripRegistrationInput = {
  full_name: string;
  whatsapp: string;
  mbbs_year: string;
  gender: string;
  emergency_contact: string;
  trip_id?: string;
  status?: string;
};

export const RAJGAD_TRIP = {
  id: "rajgad-001",
  title: "Rajgad Fort — Trip #001",
  tripNumber: "#001",
  destination: "Rajgad Fort, Pune / Bhor",
  elevation: "1,376 m (4,514 ft)",
  totalSeats: 17,
  difficulty: "Beginner–Moderate Trek",
  pickupLocation: "MIMER Medical College, Talegaon",
  pickupTime: "05:30 AM",
  returnTime: "08:30 PM",
  price: 849,
  formattedPrice: "₹849",
  statusBadge: "Registrations Open",
  duration: "1 Day (Sunday)",
  inclusions: [
    "Private Non-AC / Semi-Luxury transport from MIMER Medical College",
    "Traditional Maharashtrian breakfast & tea en route",
    "Authentic local village lunch (veg) at base camp",
    "Forest entry permits & fort conservation fees",
    "Doctor-led trekking leaders with certified medical first-aid kit",
    "High-Quality Group Photos included",
  ],
  itinerary: [
    { time: "05:30 AM", title: "MIMER College Gate Pickup", desc: "Roll call, seat allotment & energetic morning briefing at Talegaon campus." },
    { time: "07:30 AM", title: "Breakfast & Chai Break", desc: "Fresh Maharashtrian Poha/Misal and tea at Bhor base junction." },
    { time: "08:30 AM", title: "Ascent Begins (Pali)", desc: "Start trekking through the scenic wooded trail from Pali gate towards Padmavati Machi." },
    { time: "11:30 AM", title: "Padmavati Machi Summit", desc: "Explore Padmavati Temple, ancient water cisterns and historic palace ruins." },
    { time: "01:00 PM", title: "Village Lunch & Rest", desc: "Traditional home-style lunch at the fort base with mineral water." },
    { time: "02:00 PM", title: "Suvela Machi & Photo Walk", desc: "Walk the iconic needle-hole rock (Nedhe) and group photoshoot with college batchmates." },
    { time: "04:30 PM", title: "Descent to Base Village", desc: "Controlled descent with safety sweep leads and hydration checks." },
    { time: "06:30 PM", title: "Evening Snacks & Departure", desc: "Tea & snacks before boarding vehicle for smooth return trip." },
    { time: "08:30 PM", title: "Drop-off at MIMER Campus", desc: "Safe drop-off right at MIMER hostel gates well before curfew." },
  ],
  whyJoin: [
    {
      title: "Verified Itinerary",
      badge: "Curated by Medics",
      description: "Carefully timed around MBBS class, clinic postings and hostel curfew hours so you never miss academic commitments.",
    },
    {
      title: "Student Community",
      badge: "MBBS Network",
      description: "Travel exclusively with medical college peers, seniors, and batchmates from MIMER and neighbouring Pune medical colleges.",
    },
    {
      title: "Safety First",
      badge: "Doctor Supervised",
      description: "Equipped with pulse oximeters, ORS, splints, suture kits and certified emergency response by experienced doctor leads.",
    },
    {
      title: "High-Quality Group Photos",
      badge: "Group Photos",
      description: "High-quality group photos and candid mountain memories captured so you can look back on your trek with friends.",
    },
    {
      title: "Affordable Pricing",
      badge: "Non-Profit Model",
      description: "Subsidized at just ₹849 all-inclusive (travel + food + guide + group photos) — 40% cheaper than commercial operators.",
    },
  ],
} as const;

const LOCAL_STORAGE_KEY = "medtrail_trip_registrations";

function getLocalRegistrations(): TripRegistration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Failed to parse local trip registrations", e);
    return [];
  }
}

function saveLocalRegistrations(data: TripRegistration[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save local trip registrations", e);
  }
}

/**
 * Fetch all registrations for a given trip from Supabase (with graceful local fallback)
 */
export async function fetchTripRegistrations(tripId: string = RAJGAD_TRIP.id): Promise<TripRegistration[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("trip_registrations")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Supabase fetchTripRegistrations warning:", error.message);
      const local = getLocalRegistrations().filter((r) => r.trip_id === tripId);
      return local;
    }

    if (data && Array.isArray(data)) {
      saveLocalRegistrations(data as TripRegistration[]);
      return data as TripRegistration[];
    }
  } catch (err) {
    console.warn("Error calling Supabase for trip registrations:", err);
  }

  return getLocalRegistrations().filter((r) => r.trip_id === tripId);
}

/**
 * Fetch live remaining seats count for a trip
 */
export async function fetchRemainingSeats(
  tripId: string = RAJGAD_TRIP.id,
  maxSeats: number = RAJGAD_TRIP.totalSeats,
): Promise<{
  totalSeats: number;
  bookedSeats: number;
  remainingSeats: number;
  isSoldOut: boolean;
}> {
  try {
    const { count, error } = await (supabase as any)
      .from("trip_registrations")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .neq("status", "cancelled");

    if (!error && typeof count === "number") {
      const booked = count;
      const remaining = Math.max(0, maxSeats - booked);
      return {
        totalSeats: maxSeats,
        bookedSeats: booked,
        remainingSeats: remaining,
        isSoldOut: remaining === 0,
      };
    }
  } catch (e) {
    console.warn("Seat count fallback check:", e);
  }

  const local = getLocalRegistrations().filter((r) => r.trip_id === tripId && r.status !== "cancelled");
  const booked = local.length;
  const remaining = Math.max(0, maxSeats - booked);
  return {
    totalSeats: maxSeats,
    bookedSeats: booked,
    remainingSeats: remaining,
    isSoldOut: remaining === 0,
  };
}

/**
 * Register a student for a trip into Supabase trip_registrations
 */
export async function registerForTrip(
  input: TripRegistrationInput,
): Promise<{ success: boolean; data?: TripRegistration; error?: string }> {
  const tripId = input.trip_id || RAJGAD_TRIP.id;

  const seatStatus = await fetchRemainingSeats(tripId, RAJGAD_TRIP.totalSeats);
  if (seatStatus.isSoldOut) {
    return {
      success: false,
      error: "Sorry! All 17 seats for Rajgad Fort Trip #001 are currently sold out.",
    };
  }

  const newRecord: TripRegistration = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `reg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    created_at: new Date().toISOString(),
    full_name: input.full_name.trim(),
    whatsapp: input.whatsapp.trim(),
    mbbs_year: input.mbbs_year,
    gender: input.gender,
    emergency_contact: input.emergency_contact.trim(),
    trip_id: tripId,
    status: input.status || "registered",
  };

  try {
    const { data, error } = await (supabase as any)
      .from("trip_registrations")
      .insert({
        id: newRecord.id,
        created_at: newRecord.created_at,
        full_name: newRecord.full_name,
        whatsapp: newRecord.whatsapp,
        mbbs_year: newRecord.mbbs_year,
        gender: newRecord.gender,
        emergency_contact: newRecord.emergency_contact,
        trip_id: newRecord.trip_id,
        status: newRecord.status,
      })
      .select()
      .single();

    if (error) {
      console.warn("Supabase insert error, saving locally:", error.message);
      const local = getLocalRegistrations();
      saveLocalRegistrations([newRecord, ...local]);
      return { success: true, data: newRecord };
    }

    const local = getLocalRegistrations();
    saveLocalRegistrations([data as TripRegistration, ...local.filter((r) => r.id !== data.id)]);
    return { success: true, data: data as TripRegistration };
  } catch (err: any) {
    console.warn("Registration network error, saving locally:", err);
    const local = getLocalRegistrations();
    saveLocalRegistrations([newRecord, ...local]);
    return { success: true, data: newRecord };
  }
}

/**
 * Update registration status (e.g. 'registered' -> 'paid', 'confirmed', 'cancelled')
 */
export async function updateRegistrationStatus(
  id: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await (supabase as any)
      .from("trip_registrations")
      .update({ status: newStatus })
      .eq("id", id);

    if (error) {
      console.warn("Supabase update error, updating local state:", error.message);
    }
  } catch (err) {
    console.warn("Update status network error:", err);
  }

  const local = getLocalRegistrations().map((r) => (r.id === id ? { ...r, status: newStatus } : r));
  saveLocalRegistrations(local);
  return { success: true };
}

/**
 * Delete a registration (Admin only)
 */
export async function deleteRegistration(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await (supabase as any)
      .from("trip_registrations")
      .delete()
      .eq("id", id);

    if (error) {
      console.warn("Supabase delete error:", error.message);
    }
  } catch (err) {
    console.warn("Delete registration error:", err);
  }

  const local = getLocalRegistrations().filter((r) => r.id !== id);
  saveLocalRegistrations(local);
  return { success: true };
}

/**
 * Export registrations array to clean CSV download
 */
export function exportRegistrationsToCSV(
  registrations: TripRegistration[],
  filename: string = `medtrail-rajgad-trip-registrations-${new Date().toISOString().slice(0, 10)}.csv`,
) {
  if (!registrations || registrations.length === 0) {
    alert("No registrations available to export.");
    return;
  }

  const headers = [
    "Registration ID",
    "Full Name",
    "WhatsApp Number",
    "MBBS Year",
    "Gender",
    "Emergency Contact",
    "Trip ID",
    "Status",
    "Registered At (UTC)",
    "Registered At (Local)",
  ];

  const escapeCSV = (str: string | null | undefined) => {
    if (!str) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = registrations.map((r) => {
    let localDate = "";
    try {
      localDate = new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    } catch {
      localDate = r.created_at;
    }
    return [
      escapeCSV(r.id),
      escapeCSV(r.full_name),
      escapeCSV(r.whatsapp),
      escapeCSV(r.mbbs_year),
      escapeCSV(r.gender),
      escapeCSV(r.emergency_contact),
      escapeCSV(r.trip_id),
      escapeCSV(r.status),
      escapeCSV(r.created_at),
      escapeCSV(localDate),
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
