import { useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  MapPin,
  Calendar,
  Clock,
  ShieldCheck,
  CheckCircle2,
  Users,
  Camera,
  HeartPulse,
  Award,
  ChevronRight,
  Compass,
  ArrowRight,
  HelpCircle,
  Bus,
  Coffee,
  Check,
  Flame,
  AlertCircle,
  ExternalLink,
  Lock,
} from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { SeatCounter } from "@/components/trips/seat-counter";
import { RegistrationDialog } from "@/components/trips/registration-dialog";
import { RAJGAD_TRIP } from "@/lib/trip-service";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/travel")({
  head: () => ({
    meta: [
      { title: "MedTrail Trips — One-Day Treks for Medical Students" },
      {
        name: "description",
        content:
          "Affordable, safe and well-organized trekking & heritage experiences for medical college students. Trip #001: Rajgad Fort from MIMER Medical College, Talegaon.",
      },
      { property: "og:title", content: "MedTrail Trips — One-Day Treks for Medical Students" },
      {
        property: "og:description",
        content:
          "Affordable, safe and well-organized trekking & heritage experiences for medical students. Limited to 17 seats with doctor-supervised first aid and group photos.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/trips/rajgad-hero.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/trips/rajgad-hero.jpg" },
    ],
  }),
  component: MedTrailTripsPage,
});

export function MedTrailTripsPage() {
  const { user } = useAuth();
  const [remainingSeats, setRemainingSeats] = useState<number>(RAJGAD_TRIP.totalSeats);
  const [isSoldOut, setIsSoldOut] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const handleSeatsLoaded = useCallback((remaining: number, soldOut: boolean) => {
    setRemainingSeats(remaining);
    setIsSoldOut(soldOut);
  }, []);

  const handleRegisterSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="px-4 pb-24">
      <div className="mx-auto max-w-6xl space-y-24">
        {/* ========================================================================= */}
        {/* 1. HERO SECTION                                                           */}
        {/* Title: One-Day Trips for Medical Students                                  */}
        {/* Subtitle: Affordable, safe and well-organized trekking & heritage exp...   */}
        {/* Primary CTA: Register Now                                                 */}
        {/* ========================================================================= */}
        <section className="relative overflow-hidden rounded-[2.5rem] border border-border/60 bg-gradient-to-b from-primary/10 via-background to-background p-6 sm:p-12 lg:p-16">
          {/* Subtle adventure grid decoration */}
          <div className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/5" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 size-96 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-500/5" />

          <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
            {/* Left Column: Copy & CTAs */}
            <div className="lg:col-span-7">
              <Reveal>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide text-foreground">
                    <Sparkles className="size-3.5 text-amber-500" />
                    MedTrail Trips · Season 2026
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="size-3.5" /> For Medical Students
                  </span>
                </div>
              </Reveal>

              <Reveal delay={100}>
                <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl sm:leading-[1.1] text-foreground">
                  One-Day Trips for <br className="hidden sm:inline" />
                  <span className="text-gradient">Medical Students</span>
                </h1>
              </Reveal>

              <Reveal delay={180}>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  Affordable, safe and well-organized trekking & heritage experiences. Designed by
                  medics for medics — timed around exams, clinic postings, and hostel curfews.
                </p>
              </Reveal>

              {/* Key Badges Strip */}
              <Reveal delay={240}>
                <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-3 py-1.5">
                    <Bus className="size-3.5 text-primary" /> MIMER Talegaon Pickup
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-3 py-1.5">
                    <Users className="size-3.5 text-primary" /> 17 Students Only
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-3 py-1.5">
                    <HeartPulse className="size-3.5 text-emerald-500" /> Doctor Supervised
                  </span>
                </div>
              </Reveal>

              {/* Primary CTA & Live Seat Counter Trigger */}
              <Reveal delay={300} className="mt-8 flex flex-wrap items-center gap-4">
                <RegistrationDialog
                  key={refreshKey}
                  isSoldOut={isSoldOut}
                  remainingSeats={remainingSeats}
                  onSuccess={handleRegisterSuccess}
                />

                <a
                  href="#featured-trip"
                  className="glass inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-all hover:scale-[1.02]"
                >
                  View Trip Details <ChevronRight className="size-4" />
                </a>

                {user?.email?.toLowerCase() === "samarthrautrao715@gmail.com" && (
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    <Lock className="size-3.5 text-amber-400" /> Control Center
                  </Link>
                )}
              </Reveal>

              {/* Live Seat status mini text */}
              <Reveal delay={350} className="mt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                  <span>
                    Batch capacity capped at <strong>17 seats</strong> for medical safety & transport
                    comfort.
                  </span>
                </p>
              </Reveal>
            </div>

            {/* Right Column: Hero Visual Card */}
            <div className="lg:col-span-5">
              <Reveal delay={200}>
                <div className="glass group relative overflow-hidden rounded-[2.5rem] border border-border/80 p-3 shadow-2xl transition-all duration-500">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem]">
                    <img
                      src="/trips/rajgad-hero.jpg"
                      alt="Medical students at the historic stone ramparts of Rajgad Fort overlooking Sahyadri valleys"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                    {/* Floating Badges */}
                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                      <span className="rounded-full bg-black/60 backdrop-blur-md px-3 py-1 text-xs font-bold tracking-wide text-white">
                        Trip #001 · Upcoming
                      </span>
                      <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-black shadow-lg">
                        ₹849 All-inclusive
                      </span>
                    </div>

                    <div className="absolute bottom-4 left-4 right-4 text-white">
                      <p className="text-xs uppercase tracking-widest text-emerald-400 font-semibold">
                        The King of Sahyadri Forts
                      </p>
                      <h3 className="font-display text-xl font-bold sm:text-2xl mt-0.5">
                        Rajgad Fort Expedition
                      </h3>
                      <p className="mt-1 text-xs text-white/80 line-clamp-2">
                        Padmavati Machi, Suvela Machi, needle-hole rock & doctor-curated trek trails.
                      </p>
                    </div>
                  </div>

                  {/* Seat Counter integrated directly into card */}
                  <div className="p-2 pt-3">
                    <SeatCounter
                      tripId={RAJGAD_TRIP.id}
                      maxSeats={RAJGAD_TRIP.totalSeats}
                      onSeatsLoaded={handleSeatsLoaded}
                    />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 2. FEATURED TRIP CARD                                                     */}
        {/* - Rajgad Fort — Trip #001                                                 */}
        {/* - 17 Seats                                                                */}
        {/* - Beginner–Moderate Trek                                                  */}
        {/* - Pickup: MIMER Medical College, Talegaon                                 */}
        {/* - Price: ₹849                                                             */}
        {/* - Status badge: Registrations Open                                        */}
        {/* ========================================================================= */}
        <section id="featured-trip" className="scroll-mt-28">
          <Reveal>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  Official Medical College Batch
                </span>
                <h2 className="mt-1 font-display text-3xl font-bold sm:text-4xl text-foreground">
                  Featured Trip: Rajgad Fort
                </h2>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                  Carefully planned one-day weekend trek tailored specifically for MBBS students,
                  interns, and college peers.
                </p>
              </div>

              {/* Status Badge */}
              <div>
                <span
                  className={
                    isSoldOut
                      ? "inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-destructive"
                      : "inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
                  }
                >
                  <span className="size-2 rounded-full bg-current animate-ping" />
                  {isSoldOut ? "Sold Out" : RAJGAD_TRIP.statusBadge}
                </span>
              </div>
            </div>
          </Reveal>

          {/* Main Trip Card Container */}
          <Reveal delay={100} className="mt-8">
            <div className="glass overflow-hidden rounded-[2.5rem] border border-border/80 shadow-2xl">
              <div className="grid lg:grid-cols-12">
                {/* Photo & Key Metadata */}
                <div className="relative min-h-[300px] lg:col-span-5">
                  <img
                    src="/trips/student-community.jpg"
                    alt="Medical students community batch enjoying Rajgad trek together"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-black/80" />

                  <div className="absolute bottom-6 left-6 right-6 text-white space-y-2">
                    <span className="inline-block rounded-full bg-amber-500 px-3 py-1 font-mono text-xs font-bold text-black">
                      Trip #001
                    </span>
                    <h3 className="font-display text-2xl font-bold">Rajgad Fort — Trip #001</h3>
                    <p className="text-xs text-white/90">
                      Elevation: 1,376 m (4,514 ft) · Pune Sahyadris
                    </p>
                  </div>
                </div>

                {/* Details & Specs */}
                <div className="p-6 sm:p-10 lg:col-span-7 flex flex-col justify-between">
                  <div>
                    {/* Key Attributes Grid (Requirement 2 specs) */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-border/60 bg-secondary/50 p-3.5">
                        <span className="text-[0.7rem] uppercase font-semibold text-muted-foreground block">
                          Capacity
                        </span>
                        <div className="mt-1 flex items-center gap-1.5 font-display text-base font-bold text-foreground">
                          <Users className="size-4 text-primary" />
                          <span>17 Seats</span>
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">Limited small batch</span>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-secondary/50 p-3.5">
                        <span className="text-[0.7rem] uppercase font-semibold text-muted-foreground block">
                          Trek Grade
                        </span>
                        <div className="mt-1 flex items-center gap-1.5 font-display text-base font-bold text-foreground">
                          <Compass className="size-4 text-emerald-500" />
                          <span>Beginner–Mod</span>
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">Fit for all students</span>
                      </div>

                      <div className="col-span-2 sm:col-span-1 rounded-2xl border border-border/60 bg-secondary/50 p-3.5">
                        <span className="text-[0.7rem] uppercase font-semibold text-muted-foreground block">
                          Student Price
                        </span>
                        <div className="mt-1 flex items-center gap-1 font-display text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          <span>₹849</span>
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">All-inclusive non-profit</span>
                      </div>
                    </div>

                    {/* Pickup & Timings */}
                    <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-2">
                      <div className="flex items-start gap-2.5">
                        <MapPin className="size-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            Pickup & Drop-off Point:
                          </p>
                          <p className="text-xs sm:text-sm font-bold text-foreground">
                            MIMER Medical College, Talegaon Dabhade
                          </p>
                          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                            Reporting time: <strong>05:15 AM</strong> · Departure: <strong>05:30 AM</strong> · Safe return by <strong>08:30 PM</strong>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* What's Included */}
                    <div className="mt-5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                        Everything Included in ₹849:
                      </h4>
                      <ul className="grid gap-2 sm:grid-cols-2 text-xs">
                        {RAJGAD_TRIP.inclusions.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-foreground">
                            <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Seat counter + Register CTA */}
                  <div className="mt-8 border-t border-border/60 pt-6 space-y-4">
                    <SeatCounter
                      tripId={RAJGAD_TRIP.id}
                      maxSeats={RAJGAD_TRIP.totalSeats}
                      onSeatsLoaded={handleSeatsLoaded}
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground">Price per student</span>
                        <div className="flex items-baseline gap-2">
                          <span className="font-display text-2xl font-bold text-foreground">₹849</span>
                          <span className="text-xs text-muted-foreground">/ all inclusive</span>
                        </div>
                      </div>

                      <RegistrationDialog
                        key={refreshKey + 10}
                        isSoldOut={isSoldOut}
                        remainingSeats={remainingSeats}
                        onSuccess={handleRegisterSuccess}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ========================================================================= */}
        {/* 3. WHY JOIN SECTION                                                       */}
        {/* - Verified itinerary                                                      */}
        {/* - Student community                                                       */}
        {/* - Safety first                                                            */}
        {/* - Professional photography                                                */}
        {/* - Affordable pricing                                                      */}
        {/* ========================================================================= */}
        <section>
          <Reveal>
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                The MedTrail Advantage
              </span>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl text-foreground">
                Why Medical Students Join MedTrail
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                We know how demanding MBBS life is. Here is why our trips are rated 5/5 by MIMER
                medical students.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* 1. Verified Itinerary */}
            <Reveal delay={60}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-sm">
                  <Clock className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-primary">
                  Curated Timelines
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  Verified Itinerary
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Carefully planned around medical college schedule, clinical postings, and hostel
                  curfew hours. Every route is pre-trekked, timed to the minute, with zero delays.
                </p>
              </div>
            </Reveal>

            {/* 2. Student Community */}
            <Reveal delay={120}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm">
                  <Users className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  MBBS Peer Network
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  Student Community
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  No awkward mixed tourist crowds. Travel exclusively with fellow medical students,
                  seniors, interns, and batchmates from MIMER and neighboring Maharashtra colleges.
                </p>
              </div>
            </Reveal>

            {/* 3. Safety First */}
            <Reveal delay={180}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-sm">
                  <HeartPulse className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Medical Grade
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  Safety First
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Equipped with doctor-curated emergency kits: pulse oximeters, ORS, sterile dressings,
                  cramp relief, splints, and emergency evacuation protocols. Female trek leads on every trip.
                </p>
              </div>
            </Reveal>

            {/* 4. High-Quality Group Photos */}
            <Reveal delay={240}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shadow-sm">
                  <Camera className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Group Photos Included
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  High-Quality Group Photos
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Capture authentic memories with your college friends. High-resolution group photographs
                  and candid trail moments are shared directly with the batch after the trek.
                </p>
              </div>
            </Reveal>

            {/* 5. Affordable Pricing */}
            <Reveal delay={300}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-sm">
                  <Award className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Subsidized ₹849
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  Affordable Pricing
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Operated on a transparent student cost-sharing model. Commercial agencies charge ₹1,400+
                  for the same itinerary. With MedTrail, you pay just ₹849 for transport, food & guides.
                </p>
              </div>
            </Reveal>

            {/* 6. Authentic Mountain Experience */}
            <Reveal delay={360}>
              <div className="glass group h-full rounded-[2rem] border border-border/80 p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 shadow-sm">
                  <Compass className="size-6" />
                </span>
                <span className="mt-4 inline-block text-[0.7rem] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                  Heritage & Nature
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">
                  Rich Heritage & Reset
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Step away from heavy textbooks and hospital wards into the pristine mountain breeze of
                  the Sahyadris. Experience Chhatrapati Shivaji Maharaj's historic capital in its true glory.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 4. VERIFIED ITINERARY TIMELINE (Rajgad Trip #001)                         */}
        {/* ========================================================================= */}
        <section>
          <Reveal>
            <div className="text-center max-w-xl mx-auto">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Hour-by-Hour Breakdown
              </span>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl text-foreground">
                Trip #001 Schedule
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
                Strictly coordinated timeline ensuring safety, peaceful summit time, and return before
                curfew.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120} className="mt-10">
            <div className="glass rounded-[2.5rem] border border-border/80 p-6 sm:p-10">
              <div className="relative border-l-2 border-primary/30 ml-4 sm:ml-8 space-y-8 pl-6 sm:pl-8">
                {RAJGAD_TRIP.itinerary.map((item, index) => (
                  <div key={index} className="relative group">
                    {/* Glowing Bullet */}
                    <div className="absolute -left-[31px] sm:-left-[39px] top-1 size-4 rounded-full border-2 border-primary bg-background transition-transform group-hover:scale-125 group-hover:bg-primary" />

                    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                      <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full w-fit">
                        {item.time}
                      </span>
                      <h4 className="font-display text-base font-bold text-foreground">
                        {item.title}
                      </h4>
                    </div>
                    <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ========================================================================= */}
        {/* 5. DOCTOR'S PACKING & SAFETY CHECKLIST                                    */}
        {/* ========================================================================= */}
        <section>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Checklist */}
            <Reveal>
              <div className="glass h-full rounded-[2.5rem] border border-border/80 p-6 sm:p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-bold">What to Carry</h3>
                    <p className="text-xs text-muted-foreground">Packing list for 1-day trek</p>
                  </div>
                </div>

                <ul className="space-y-3 text-xs sm:text-sm">
                  {[
                    "Medical College / Student ID card (Mandatory)",
                    "Sturdy sports or trekking shoes with proper sole grip",
                    "2 Litres of water in reusable bottle (hydration is key)",
                    "Comfortable breathable quick-dry clothes + light windcheater",
                    "Small backpack (20-30L) to keep hands free",
                    "Sun cap, sunscreen & personal medications if prescribed",
                  ].map((tip, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-muted-foreground">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[0.65rem]">
                        ✓
                      </span>
                      <span className="text-foreground">{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* Medical Safety Gear provided by MedTrail */}
            <Reveal delay={100}>
              <div className="glass h-full rounded-[2.5rem] border border-border/80 p-6 sm:p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <HeartPulse className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-bold">MedTrail First Aid Kit</h3>
                    <p className="text-xs text-muted-foreground">Carried by trek leads on trail</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  {[
                    "Pulse Oximeter & SpO2 monitor",
                    "Sterile gauze, bandage & Betadine",
                    "Electral ORS sachets for hydration",
                    "Volini spray & crepe bandaging",
                    "Anti-emetics & paracetamol",
                    "Emergency stretcher strap & splints",
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-border/60 bg-secondary/40 p-2.5 flex items-center gap-2"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-medium text-foreground">{item}</span>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-3">
                  Led by experienced trek leaders who are themselves medical professionals with BLS
                  (Basic Life Support) orientation.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 6. FAQS SECTION                                                           */}
        {/* ========================================================================= */}
        <section>
          <Reveal>
            <div className="text-center max-w-xl mx-auto">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Common Questions
              </span>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl text-foreground">
                Frequently Asked Questions
              </h2>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                q: "Who can register for MedTrail Trips?",
                a: "Registrations are strictly reserved for MBBS students, interns, postgraduates, and healthcare staff of MIMER Medical College (Talegaon) and neighboring medical colleges in Pune/PCMC.",
              },
              {
                q: "What if all 17 seats are filled?",
                a: "Once the seat counter reaches 17, registrations automatically close. A waitlist will be maintained for Trip #002. You can stay in touch with MedTrail for next departure dates.",
              },
              {
                q: "What is included in the ₹849 fee?",
                a: "Dedicated pickup and drop-off non-AC transport from MIMER campus, hot morning breakfast & tea, authentic Maharashtrian village lunch, forest entry fees, doctor-guided safety supervision, and high-quality group photos.",
              },
              {
                q: "What is the trek difficulty level?",
                a: "Beginner to Moderate. The trail has well-marked stone steps and paths. No technical rock climbing gear is needed. If you can walk for 2 hours, you can comfortably reach Padmavati Machi!",
              },
            ].map((faq, i) => (
              <Reveal key={i} delay={i * 60}>
                <div className="glass rounded-[2rem] border border-border/80 p-6 space-y-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                    <HelpCircle className="size-4 text-primary shrink-0" />
                    <h4>{faq.q}</h4>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-6">
                    {faq.a}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 7. FINAL CALL TO ACTION                                                   */}
        {/* ========================================================================= */}
        <section>
          <Reveal className="glass relative overflow-hidden rounded-[2.5rem] border border-primary/30 p-8 sm:p-14 text-center">
            <div className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-amber-500/10 blur-3xl" />

            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <Flame className="size-3.5" /> Trip #001 · Rajgad Fort
            </span>

            <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-5xl text-foreground">
              Ready to Climb with Your Batchmates?
            </h2>

            <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground leading-relaxed sm:text-base">
              Grab your seat before all 17 spots fill up. Leave the library books behind for a day and
              recharge your medical mind in the mountains.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <RegistrationDialog
                key={refreshKey + 20}
                isSoldOut={isSoldOut}
                remainingSeats={remainingSeats}
                onSuccess={handleRegisterSuccess}
              />

              <Link
                to="/destinations"
                className="glass inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-transform hover:scale-105"
              >
                Browse Destination Guides <ArrowRight className="size-4" />
              </Link>
            </div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
