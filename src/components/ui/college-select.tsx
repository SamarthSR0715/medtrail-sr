import React, { useState, useEffect, useMemo, useRef } from "react";
import { Check, ChevronsUpDown, Search, Building2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface MedicalCollegeItem {
  id: string;
  college_name: string;
  city: string;
  state: string;
  college_type?: string;
  active?: boolean;
}

// Fallback seed list of all 80 recognized MBBS medical colleges in Maharashtra
// Ensures immediate zero-latency dropdown rendering even prior to DB migration
export const OFFICIAL_MAHARASHTRA_COLLEGES: MedicalCollegeItem[] = [
  { id: "col-afmc-pune", college_name: "Armed Forces Medical College (AFMC), Pune", city: "Pune", state: "Maharashtra", college_type: "Central Government" },
  { id: "col-aiims-nagpur", college_name: "All India Institute of Medical Sciences (AIIMS), Nagpur", city: "Nagpur", state: "Maharashtra", college_type: "Central Government" },
  { id: "col-aiims-delhi", college_name: "All India Institute of Medical Sciences (AIIMS), New Delhi", city: "New Delhi", state: "Delhi", college_type: "Central Government" },
  { id: "col-bjmc-pune", college_name: "B. J. Government Medical College, Pune", city: "Pune", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-mumbai", college_name: "Grant Government Medical College and Sir J.J. Group of Hospitals, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-miraj", college_name: "Government Medical College, Miraj", city: "Miraj", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-nagpur", college_name: "Government Medical College, Nagpur", city: "Nagpur", state: "Maharashtra", college_type: "Government" },
  { id: "col-iggmc-nagpur", college_name: "Indira Gandhi Government Medical College, Nagpur", city: "Nagpur", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-csn", college_name: "Government Medical College, Chhatrapati Sambhajinagar", city: "Chhatrapati Sambhajinagar", state: "Maharashtra", college_type: "Government" },
  { id: "col-vmgmc-solapur", college_name: "Dr. Vaishampayan Memorial Government Medical College (VMGMC), Solapur", city: "Solapur", state: "Maharashtra", college_type: "Government" },
  { id: "col-scgmc-nanded", college_name: "Dr. Shankarrao Chavan Government Medical College, Nanded", city: "Nanded", state: "Maharashtra", college_type: "Government" },
  { id: "col-svngmc-yavatmal", college_name: "Shri Vasantrao Naik Government Medical College, Yavatmal", city: "Yavatmal", state: "Maharashtra", college_type: "Government" },
  { id: "col-sbhgmc-dhule", college_name: "Shri Bhausaheb Hire Government Medical College, Dhule", city: "Dhule", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-akola", college_name: "Government Medical College, Akola", city: "Akola", state: "Maharashtra", college_type: "Government" },
  { id: "col-rcsm-kolhapur", college_name: "R.C.S.M. Government Medical College and CPR Hospital, Kolhapur", city: "Kolhapur", state: "Maharashtra", college_type: "Government" },
  { id: "col-srtr-ambajogai", college_name: "Swami Ramanand Teerth Rural Government Medical College, Ambajogai", city: "Ambajogai", state: "Maharashtra", college_type: "Government" },
  { id: "col-vdgmc-latur", college_name: "Vilasrao Deshmukh Government Medical College, Latur", city: "Latur", state: "Maharashtra", college_type: "Government" },
  { id: "col-kdgmc-chandrapur", college_name: "Karmavir Dadasaheb Kannamwar Government Medical College, Chandrapur", city: "Chandrapur", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-gondia", college_name: "Government Medical College, Gondia", city: "Gondia", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-jalgaon", college_name: "Government Medical College, Jalgaon", city: "Jalgaon", state: "Maharashtra", college_type: "Government" },
  { id: "col-pahgmc-baramati", college_name: "Punyashlok Ahilyadevi Holkar Government Medical College, Baramati", city: "Baramati", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-nandurbar", college_name: "Government Medical College and Hospital, Nandurbar", city: "Nandurbar", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-satara", college_name: "Government Medical College, Satara", city: "Satara", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-alibag", college_name: "Government Medical College, Alibag", city: "Alibag", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-sindhudurg", college_name: "Government Medical College, Sindhudurg", city: "Sindhudurg", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-osmanabad", college_name: "Government Medical College, Osmanabad (Dharashiv)", city: "Dharashiv", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-ratnagiri", college_name: "Government Medical College, Ratnagiri", city: "Ratnagiri", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-parbhani", college_name: "Government Medical College, Parbhani", city: "Parbhani", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-gadchiroli", college_name: "Government Medical College, Gadchiroli", city: "Gadchiroli", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-amravati", college_name: "Government Medical College, Amravati", city: "Amravati", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-washim", college_name: "Government Medical College, Washim", city: "Washim", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-jalna", college_name: "Government Medical College, Jalna", city: "Jalna", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-buldhana", college_name: "Government Medical College, Buldhana", city: "Buldhana", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-bhandara", college_name: "Government Medical College, Bhandara", city: "Bhandara", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-hingoli", college_name: "Government Medical College, Hingoli", city: "Hingoli", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-ambernath", college_name: "Government Medical College, Ambernath (Thane)", city: "Ambernath", state: "Maharashtra", college_type: "Government" },
  { id: "col-gmc-gthosp-mumbai", college_name: "Government Medical College, G.T. Hospital Campus, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Government" },
  { id: "col-muhs-pgi-nashik", college_name: "MUHS Post Graduate Institute of Medical Education and Research, Nashik", city: "Nashik", state: "Maharashtra", college_type: "Government" },
  { id: "col-seth-gs-mumbai", college_name: "Seth GS Medical College, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-tnmc-nair-mumbai", college_name: "Topiwala National Medical College and BYL Nair Charitable Hospital, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-ltmmc-sion-mumbai", college_name: "Lokmanya Tilak Municipal Medical College and Sion Hospital, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-hbtmc-cooper-mumbai", college_name: "HBT Medical College and Dr. R.N. Cooper Hospital, Juhu, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-rgmc-kalwa-thane", college_name: "Rajiv Gandhi Medical College and CSM Hospital, Kalwa, Thane", city: "Thane", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-abvmc-pune", college_name: "Bharatratna Atal Bihari Vajpayee Medical College, Pune", city: "Pune", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-ycm-pcmc", college_name: "Post Graduate Institute of Yashwantrao Chavan Memorial Hospital, Pimpri-Chinchwad", city: "Pimpri-Chinchwad", state: "Maharashtra", college_type: "Municipal" },
  { id: "col-mimer-pune", college_name: "MIMER Medical College, Talegaon Dabhade, Pune", city: "Talegaon Dabhade", state: "Maharashtra", college_type: "Private" },
  { id: "col-rk-damani", college_name: "R.K. Damani Medical College", city: "Chhatrapati Sambhajinagar", state: "Maharashtra", college_type: "Private" },
  { id: "col-kj-somaiya-mumbai", college_name: "K. J. Somaiya Medical College and Research Centre, Mumbai", city: "Mumbai", state: "Maharashtra", college_type: "Private" },
  { id: "col-sknmc-pune", college_name: "Smt. Kashibai Navale Medical College and General Hospital, Pune", city: "Pune", state: "Maharashtra", college_type: "Private" },
  { id: "col-terna-navi-mumbai", college_name: "Terna Medical College, Nerul, Navi Mumbai", city: "Navi Mumbai", state: "Maharashtra", college_type: "Private" },
  { id: "col-dr-vp-nashik", college_name: "Dr. Vasantrao Pawar Medical College Hospital and Research Centre, Nashik", city: "Nashik", state: "Maharashtra", college_type: "Private" },
  { id: "col-bkl-walawalkar", college_name: "B.K.L. Walawalkar Rural Medical College, Dervan, Chiplun, Ratnagiri", city: "Ratnagiri", state: "Maharashtra", college_type: "Private" },
  { id: "col-acpm-dhule", college_name: "ACPM Medical College, Dhule", city: "Dhule", state: "Maharashtra", college_type: "Private" },
  { id: "col-ashwini-solapur", college_name: "Ashwini Rural Medical College, Hospital and Research Centre, Solapur", city: "Solapur", state: "Maharashtra", college_type: "Private" },
  { id: "col-nkp-salve-nagpur", college_name: "N.K.P. Salve Institute of Medical Sciences and Research Centre, Nagpur", city: "Nagpur", state: "Maharashtra", college_type: "Private" },
  { id: "col-pdmc-amravati", college_name: "Dr. Panjabrao Deshmukh Memorial Medical College, Amravati", city: "Amravati", state: "Maharashtra", college_type: "Private" },
  { id: "col-ulhas-patil-jalgaon", college_name: "Dr. Ulhas Patil Medical College and Hospital, Jalgaon", city: "Jalgaon", state: "Maharashtra", college_type: "Private" },
  { id: "col-vikhe-patil-ahmednagar", college_name: "Dr. Vithalrao Vikhe Patil Foundations Medical College and Hospital, Ahmednagar", city: "Ahmednagar", state: "Maharashtra", college_type: "Private" },
  { id: "col-mimsr-latur", college_name: "Maharashtra Institute of Medical Science and Research (MIMSR), Latur", city: "Latur", state: "Maharashtra", college_type: "Private" },
  { id: "col-mgims-sevagram", college_name: "Mahatma Gandhi Institute of Medical Sciences (MGIMS), Sevagram, Wardha", city: "Sevagram", state: "Maharashtra", college_type: "Trust/Govt-Aided" },
  { id: "col-iimsr-jalna", college_name: "Indian Institute of Medical Science and Research (IIMSR), Warudi, Jalna", city: "Jalna", state: "Maharashtra", college_type: "Private" },
  { id: "col-pims-sangli", college_name: "Prakash Institute of Medical Sciences and Research, Urun-Islampur, Sangli", city: "Sangli", state: "Maharashtra", college_type: "Private" },
  { id: "col-smbt-nashik", college_name: "SMBT Institute of Medical Sciences and Research Centre, Nandi Hills, Nashik", city: "Nashik", state: "Maharashtra", college_type: "Private" },
  { id: "col-sspm-sindhudurg", college_name: "SSPM Medical College and Lifetime Hospital, Padave, Sindhudurg", city: "Sindhudurg", state: "Maharashtra", college_type: "Private" },
  { id: "col-vedantaa-palghar", college_name: "Vedantaa Institute of Medical Sciences, Saswand, Dhundalwadi, Palghar", city: "Palghar", state: "Maharashtra", college_type: "Private" },
  { id: "col-tasgaonkar-karjat", college_name: "Dr. N. Y. Tasgaonkar Institute of Medical Science, Karjat", city: "Karjat", state: "Maharashtra", college_type: "Private" },
  { id: "col-rajendra-gode-amravati", college_name: "Dr. Rajendra Gode Medical College, Amravati", city: "Amravati", state: "Maharashtra", college_type: "Private" },
  { id: "col-parbhani-medical-college", college_name: "Parbhani Medical College and Hospital, Parbhani", city: "Parbhani", state: "Maharashtra", college_type: "Private" },
  { id: "col-dypatil-pune", college_name: "Dr. D. Y. Patil Medical College, Hospital and Research Centre, Pimpri, Pune", city: "Pune", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-dypatil-navi-mumbai", college_name: "Dr. D. Y. Patil School of Medicine, Nerul, Navi Mumbai", city: "Navi Mumbai", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-dypatil-kolhapur", college_name: "Dr. D. Y. Patil Medical College, Kasaba Bawada, Kolhapur", city: "Kolhapur", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-bvp-pune", college_name: "Bharati Vidyapeeth University Medical College, Pune", city: "Pune", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-bvp-sangli", college_name: "Bharati Vidyapeeth Deemed University Medical College and Hospital, Sangli", city: "Sangli", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-kims-karad", college_name: "Krishna Institute of Medical Sciences (KIMS), Karad", city: "Karad", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-pravara-loni", college_name: "Rural Medical College, Pravara Institute of Medical Sciences, Loni", city: "Loni", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-mgm-navi-mumbai", college_name: "MGM Medical College and Hospital, Kamothe, Navi Mumbai", city: "Navi Mumbai", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-mgm-csn", college_name: "MGM Medical College and Hospital, Chhatrapati Sambhajinagar", city: "Chhatrapati Sambhajinagar", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-jnmc-wardha", college_name: "Jawaharlal Nehru Medical College, Sawangi (Meghe), Wardha", city: "Wardha", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-datta-meghe-nagpur", college_name: "Datta Meghe Medical College, Wanadongri, Hingna, Nagpur", city: "Nagpur", state: "Maharashtra", college_type: "Deemed" },
  { id: "col-symbiosis-pune", college_name: "Symbiosis Medical College for Women (SMCW), Lavale, Pune", city: "Pune", state: "Maharashtra", college_type: "Deemed" },
];

export interface CollegeSelectProps {
  value: string; // canonical college name or college id
  selectedCollegeId?: string | null | undefined;
  onChange: (collegeName: string, collegeId?: string | undefined) => void;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}

export function CollegeSelect({
  value,
  selectedCollegeId,
  onChange,
  required = false,
  disabled = false,
  placeholder = "Search medical college by name or city...",
  className = "",
}: CollegeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [colleges, setColleges] = useState<MedicalCollegeItem[]>(OFFICIAL_MAHARASHTRA_COLLEGES);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch active colleges from Supabase medical_colleges table if available
  useEffect(() => {
    let isMounted = true;
    async function loadColleges() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("medical_colleges" as any)
          .select("id, college_name, city, state, college_type, active")
          .eq("active", true)
          .order("college_name");

        if (!error && data && data.length > 0 && isMounted) {
          setColleges(data as any);
        }
      } catch {
        // Fallback to static official list if DB table is pending creation
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadColleges();
    return () => {
      isMounted = false;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Filter colleges by name and city
  const filteredColleges = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return colleges;
    return colleges.filter(
      (c) =>
        c.college_name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.college_type && c.college_type.toLowerCase().includes(q))
    );
  }, [colleges, search]);

  // Find currently selected college object
  const currentSelection = useMemo(() => {
    if (selectedCollegeId) {
      const match = colleges.find((c) => c.id === selectedCollegeId);
      if (match) return match;
    }
    if (value) {
      const trimmed = value.trim().toLowerCase();
      const match = colleges.find(
        (c) =>
          c.college_name.toLowerCase() === trimmed ||
          c.id === value
      );
      if (match) return match;
    }
    return null;
  }, [colleges, value, selectedCollegeId]);

  const handleSelect = (college: MedicalCollegeItem) => {
    onChange(college.college_name, college.id);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-left text-sm flex items-center justify-between gap-2 transition focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
          disabled ? "opacity-60 cursor-not-allowed" : "hover:border-slate-700 cursor-pointer"
        } ${!currentSelection && required ? "border-slate-800" : ""}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
          {currentSelection ? (
            <div className="truncate">
              <span className="text-white font-medium block truncate">
                {currentSelection.college_name}
              </span>
              <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-slate-500" />
                {currentSelection.city}, {currentSelection.state}
                {currentSelection.college_type && (
                  <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded bg-slate-800 text-slate-300">
                    {currentSelection.college_type}
                  </span>
                )}
              </span>
            </div>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
        </div>
        <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {/* Hidden input for HTML form validation */}
      <input
        type="text"
        required={required}
        value={currentSelection?.college_name || ""}
        onChange={() => {}}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100">
          {/* Search Box */}
          <div className="p-2.5 border-b border-slate-800 flex items-center gap-2 bg-slate-950/80">
            <Search className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by college name, city (e.g. Miraj, Pune, Mumbai)..."
              className="w-full bg-transparent text-white text-xs placeholder:text-slate-500 focus:outline-none py-1"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800"
              >
                Clear
              </button>
            )}
          </div>

          {/* List Options */}
          <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
            {filteredColleges.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-slate-400">
                <p className="font-semibold text-slate-300">No medical colleges match your search</p>
                <p className="mt-1 text-slate-500">
                  Try searching by district or city (e.g., Miraj, Talegaon, Nagpur, Mumbai).
                </p>
              </div>
            ) : (
              filteredColleges.map((college) => {
                const isSelected =
                  currentSelection?.id === college.id ||
                  currentSelection?.college_name === college.college_name;

                return (
                  <button
                    key={college.id}
                    type="button"
                    onClick={() => handleSelect(college)}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition flex items-start justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? "bg-blue-600/20 text-blue-200 border border-blue-500/30 font-medium"
                        : "text-slate-200 hover:bg-slate-800/80"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white truncate text-xs flex items-center gap-1.5">
                        <span className="truncate">{college.college_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          {college.city}
                        </span>
                        {college.college_type && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 border border-slate-700/50">
                            {college.college_type}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Helper footer */}
          <div className="p-2 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-400 text-center flex items-center justify-between px-3">
            <span>Official NMC / DMER recognized MBBS colleges</span>
            <span className="text-slate-500">{filteredColleges.length} available</span>
          </div>
        </div>
      )}
    </div>
  );
}
