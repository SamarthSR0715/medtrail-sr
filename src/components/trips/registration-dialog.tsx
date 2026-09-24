import { useState, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  AlertCircle,
  Copy,
  Calendar,
  MapPin,
  IndianRupee,
  ShieldCheck,
  Check,
} from "lucide-react";
import { RAJGAD_TRIP, registerForTrip, type TripRegistration } from "@/lib/trip-service";
import { toast } from "sonner";

interface RegistrationDialogProps {
  isSoldOut?: boolean;
  remainingSeats?: number;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function RegistrationDialog({
  isSoldOut = false,
  remainingSeats = RAJGAD_TRIP.totalSeats,
  trigger,
  onSuccess,
}: RegistrationDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [registration, setRegistration] = useState<TripRegistration | null>(null);
  const [copied, setCopied] = useState(false);

  // Form State
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [mbbsYear, setMbbsYear] = useState("2nd Year MBBS");
  const [gender, setGender] = useState("Male");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [consentFit, setConsentFit] = useState(true);

  const nameId = useId();
  const whatsappId = useId();
  const yearId = useId();
  const genderId = useId();
  const emergencyId = useId();
  const consentId = useId();

  function resetForm() {
    setFullName("");
    setWhatsapp("");
    setMbbsYear("2nd Year MBBS");
    setGender("Male");
    setEmergencyContact("");
    setErrorMsg("");
    setRegistration(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setErrorMsg("");

    // Validation
    if (!fullName.trim() || fullName.trim().length < 2) {
      setErrorMsg("Please enter your complete full name.");
      return;
    }

    const cleanPhone = whatsapp.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      setErrorMsg("Please enter a valid 10-digit WhatsApp number.");
      return;
    }

    if (!emergencyContact.trim() || emergencyContact.trim().length < 5) {
      setErrorMsg("Please provide an emergency contact name and phone number.");
      return;
    }

    if (!consentFit) {
      setErrorMsg("Please acknowledge physical fitness and trek terms to continue.");
      return;
    }

    if (isSoldOut || remainingSeats <= 0) {
      setErrorMsg("Sorry, this trip is now completely sold out.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await registerForTrip({
        full_name: fullName.trim(),
        whatsapp: whatsapp.trim(),
        mbbs_year: mbbsYear,
        gender,
        emergency_contact: emergencyContact.trim(),
        trip_id: RAJGAD_TRIP.id,
        status: "registered",
      });

      if (!res.success) {
        setErrorMsg(res.error || "Registration failed. Please try again.");
        toast.error(res.error || "Registration could not be completed.");
      } else if (res.data) {
        setRegistration(res.data);
        toast.success("Seat registered successfully! Welcome aboard Trip #001.");
        onSuccess?.();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopyDetails() {
    if (!registration) return;
    const text = `MedTrail Trips Registration Confirmation\nTrip: ${RAJGAD_TRIP.title}\nReg ID: ${registration.id}\nStudent: ${registration.full_name}\nYear: ${registration.mbbs_year}\nPickup: ${RAJGAD_TRIP.pickupLocation}\nPrice: ${RAJGAD_TRIP.formattedPrice}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Registration summary copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) {
          setTimeout(resetForm, 300);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger || (
          <button
            type="button"
            disabled={isSoldOut}
            className={
              isSoldOut
                ? "inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-muted px-6 py-3 text-sm font-semibold text-muted-foreground opacity-60"
                : "bg-gradient-brand inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-brand-foreground shadow-xl transition-all duration-300 hover:scale-[1.03] hover:shadow-primary/25 cursor-pointer"
            }
          >
            <Sparkles className="size-4" />
            {isSoldOut ? "Sold Out" : "Register Now"}
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl rounded-3xl border-border/80 bg-background/95 backdrop-blur-xl p-6 sm:p-8">
        {!registration ? (
          <>
            <DialogHeader className="space-y-2 text-left">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <ShieldCheck className="size-3.5" /> Medical Student Exclusive
                </span>
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  {RAJGAD_TRIP.tripNumber}
                </span>
              </div>
              <DialogTitle className="font-display text-2xl font-bold tracking-tight">
                Register for {RAJGAD_TRIP.title}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Affordable, doctor-guided one-day Sahyadri expedition. Secure your seat below.
              </DialogDescription>
            </DialogHeader>

            {/* Quick Trip Snapshot Pill */}
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-secondary/40 p-3 text-xs">
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-primary shrink-0" />
                <span className="truncate">Talegaon Pickup</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="size-3.5 text-primary shrink-0" />
                <span>Sunday</span>
              </div>
              <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <IndianRupee className="size-3.5 shrink-0" />
                <span>849 all-inclusive</span>
              </div>
            </div>

            {/* Seats status notification banner */}
            {isSoldOut ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>This batch is currently sold out (17/17 seats filled).</span>
              </div>
            ) : remainingSeats <= 4 ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Sparkles className="size-4 shrink-0" />
                <span>Hurry! Only {remainingSeats} seats remaining for this batch.</span>
              </div>
            ) : null}

            {errorMsg && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-3 space-y-4">
              {/* Full Name */}
              <div>
                <label htmlFor={nameId} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Full Name *
                </label>
                <input
                  id={nameId}
                  type="text"
                  required
                  placeholder="e.g. Dr. Aryan Kulkarni"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* WhatsApp & MBBS Year Grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={whatsappId} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    WhatsApp Number *
                  </label>
                  <input
                    id={whatsappId}
                    type="tel"
                    required
                    placeholder="10-digit mobile number"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label htmlFor={yearId} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    MBBS Year *
                  </label>
                  <select
                    id={yearId}
                    value={mbbsYear}
                    onChange={(e) => setMbbsYear(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-medium text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="1st Year MBBS">1st Year MBBS</option>
                    <option value="2nd Year MBBS">2nd Year MBBS</option>
                    <option value="3rd Year (Part 1)">3rd Year (Part 1)</option>
                    <option value="Final Year MBBS">Final Year MBBS</option>
                    <option value="Intern / House Surgeon">Intern / House Surgeon</option>
                    <option value="Doctor / Resident">Doctor / Resident</option>
                  </select>
                </div>
              </div>

              {/* Gender & Emergency Contact Grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={genderId} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Gender *
                  </label>
                  <select
                    id={genderId}
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-medium text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other / Prefer not to say">Other / Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={emergencyId} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Emergency Contact *
                  </label>
                  <input
                    id={emergencyId}
                    type="text"
                    required
                    placeholder="Parent / Guardian & Phone"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Consent Checkbox */}
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  id={consentId}
                  type="checkbox"
                  checked={consentFit}
                  onChange={(e) => setConsentFit(e.target.checked)}
                  className="size-4 mt-0.5 rounded border-input text-primary focus:ring-primary/30"
                />
                <label htmlFor={consentId} className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none">
                  I confirm that I am a medical college student / intern, physically fit for a 1-day beginner–moderate trek, and will adhere to the safety guidelines.
                </label>
              </div>

              {/* Actions */}
              <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full sm:w-auto rounded-full border border-border px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || isSoldOut}
                  className="w-full sm:w-auto bg-gradient-brand inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-brand-foreground shadow-md transition-all hover:scale-[1.02] disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <span>Complete Registration</span>
                      <span className="opacity-80">· ₹849</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          /* Success Screen */
          <div className="py-4 text-center space-y-5">
            <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-9" />
            </div>

            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Seat Reserved Successfully
              </span>
              <h3 className="font-display text-2xl font-bold mt-2">You're going to Rajgad Fort!</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                We have registered your seat for Trip #001 departing from MIMER Medical College, Talegaon.
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Registration ID:</span>
                <span className="font-mono font-medium text-foreground">{registration.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Student Name:</span>
                <span className="font-semibold text-foreground">{registration.full_name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">MBBS Year:</span>
                <span>{registration.mbbs_year}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Pickup Location:</span>
                <span>MIMER Medical College, Talegaon (05:30 AM)</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">Trip Amount:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">₹849 (Payable via UPI)</span>
              </div>
            </div>

            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-left text-xs space-y-1">
              <p className="font-semibold text-amber-800 dark:text-amber-300">Next Steps:</p>
              <p className="text-muted-foreground">
                1. You will be added to the official <strong>MedTrail Rajgad #001 WhatsApp Group</strong> within 24 hours.
              </p>
              <p className="text-muted-foreground">
                2. UPI payment instructions (GPay / PhonePe) will be sent on WhatsApp to finalize your seat badge.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleCopyDetails}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-border px-5 py-2.5 text-xs font-semibold hover:bg-secondary transition-colors"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "Copied!" : "Copy Details"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setTimeout(resetForm, 300);
                }}
                className="w-full sm:w-auto bg-gradient-brand inline-flex items-center justify-center rounded-full px-6 py-2.5 text-xs font-semibold text-brand-foreground shadow-md transition-all hover:scale-[1.02]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
