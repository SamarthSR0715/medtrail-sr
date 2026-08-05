import routeKataldhar from "@/assets/routes/route-0281.jpg.asset.json";
import routeVisapur from "@/assets/routes/route-0282.jpg.asset.json";
import routePawna from "@/assets/routes/route-0284.jpg.asset.json";
import routeTikona from "@/assets/routes/route-0285.jpg.asset.json";
import kataldharWide from "@/assets/photos-0286.jpg.asset.json";
import kataldharDrops from "@/assets/photos-0287.jpg.asset.json";
import tikonaPeak from "@/assets/photos-0288.jpg.asset.json";
import tikonaSummit from "@/assets/photos-0289.jpg.asset.json";
import pawnaTent from "@/assets/photos-0290.jpg.asset.json";
import pawnaEvening from "@/assets/photos-0291.jpg.asset.json";
import pawnaFromTikona from "@/assets/photos-0292.jpg.asset.json";
import lonavalaBhutta from "@/assets/photos-0293.jpg.asset.json";
import bhajeCaves from "@/assets/photos-0294.jpg.asset.json";

/** Real, unedited photographs shot on the trips themselves. */
export const realPhotos = {
  kataldharWide: kataldharWide.url,
  kataldharDrops: kataldharDrops.url,
  tikonaPeak: tikonaPeak.url,
  tikonaSummit: tikonaSummit.url,
  pawnaTent: pawnaTent.url,
  pawnaEvening: pawnaEvening.url,
  pawnaFromTikona: pawnaFromTikona.url,
  lonavalaBhutta: lonavalaBhutta.url,
  bhajeCaves: bhajeCaves.url,
} as const;

export const categories = [
  "Forts",
  "Waterfalls",
  "Trekking",
  "Temples",
  "Beaches",
  "Nature",
  "Camping",
  "Caves",
] as const;

export type Category = (typeof categories)[number];

export type Photo = {
  id: string;
  src: string;
  destination: string;
  slug?: string;
  district: string;
  state: string;
  date: string;
  caption: string;
  tags: Category[];
  cover?: boolean;
};

export type TimelineStop = {
  mode: "start" | "train" | "metro" | "bus" | "jeep" | "walk" | "trek" | "view" | "end";
  title: string;
  detail: string;
  time: string;
};

export type Destination = {
  slug: string;
  name: string;
  tagline: string;
  district: string;
  state: string;
  categories: Category[];
  hero: string;
  routeMap: string;
  lat: number;
  lng: number;
  distanceKm: number;
  travelTime: string;
  trekTime: string;
  trekDistanceKm: number;
  elevationM: number;
  difficulty: "Easy" | "Easy to Moderate" | "Moderate" | "Moderate to Difficult";
  rating: number;
  season: string;
  weather: string;
  sunrise: string;
  sunset: string;
  visitedOn: string;
  summary: string;
  story: string;
  highlights: string[];
  carry: string[];
  nearby: string[];
  photoSpots: string[];
  tips: string[];
  safety: string[];
  expenses: { label: string; amount: string }[];
  timeline: TimelineStop[];
  info: {
    entryFee: string;
    parking: string;
    food: string;
    water: string;
    washrooms: string;
    network: string;
    camping: string;
    guide: string;
  };
  gallery: string[];
  googleMapsUrl: string;
};

export const destinations: Destination[] = [
  {
    slug: "kataldhar-rajmachi",
    name: "Kataldhar Waterfall & Rajmachi Fort",
    tagline: "A journey through forest, off-roads & history",
    district: "Pune",
    state: "Maharashtra",
    categories: ["Waterfalls", "Forts", "Trekking", "Nature"],
    hero: realPhotos.kataldharWide,
    routeMap: routeKataldhar.url,
    lat: 18.8291,
    lng: 73.4285,
    distanceKm: 68,
    travelTime: "2.5 – 3 hrs",
    trekTime: "1.5 – 2 hrs one way",
    trekDistanceKm: 4,
    elevationM: 826,
    difficulty: "Moderate to Difficult",
    rating: 4.8,
    season: "June to September (Monsoon)",
    weather: "Monsoon: 20–26°C, heavy rain and thick mist. Winter: 14–24°C, clear ridge views.",
    sunrise: "6:05 AM",
    sunset: "7:10 PM",
    visitedOn: "2025-08-16",
    summary:
      "Local train to Lonavala, a shared Sumo through village off-roads, then a dense jungle trek to the roaring Kataldhar falls before climbing to Rajmachi's twin heads.",
    story:
      "We caught the 5:40 local from Pune Junction with wet shoes already on. Lonavala was grey and dripping. The Sumo ride past Kusgaon, Daregaon and Bhatane was pure off-road — mud, streams and green walls on both sides. The forest trail to Kataldhar drops steeply through leeches and rock; then the sound arrives before the waterfall does. Rajmachi's Shrivardhan and Manoranjan heads came after lunch, with the old Shiv temple sitting quietly between them. Not all classrooms have walls.",
    highlights: [
      "Kataldhar's 100m curtain fall in full monsoon roar",
      "Off-road Sumo ride through Sahyadri villages",
      "Twin fort heads — Shrivardhan and Manoranjan",
      "Ancient Shiv temple inside the fort area",
    ],
    carry: ["2–3L water", "Trekking shoes with grip", "Raincoat / poncho", "Energy snacks", "Power bank", "ID proof"],
    nearby: ["Lonavala", "Bhushi Dam", "Della Adventure Park", "Tungarli Lake"],
    photoSpots: ["Kataldhar base rocks", "Rajmachi ridge saddle", "Shrivardhan bastion", "Village exit point trail"],
    tips: [
      "Start early morning — the trail crowds after 10am",
      "Monsoon is best but the descent gets slippery",
      "Keep the place clean & respect nature",
    ],
    safety: [
      "Never stand under the falls during heavy rain",
      "Carry salt or antiseptic for leeches",
      "Return from the fort before dusk",
    ],
    expenses: [
      { label: "Local train (Pune → Lonavala)", amount: "₹30 – 60" },
      { label: "Shared cab / Sumo (return)", amount: "₹300 – 500" },
      { label: "Food & charges", amount: "₹150 – 200" },
      { label: "Total per person", amount: "₹500 – 700" },
    ],
    timeline: [
      { mode: "start", title: "Pune Junction", detail: "Board the Lonavala local", time: "0:00" },
      { mode: "train", title: "Local train", detail: "~64 km to Lonavala", time: "1.5 – 2 hrs" },
      { mode: "jeep", title: "Lonavala (Out) → village exit", detail: "Shared Sumo, off-roading starts", time: "45 – 60 min" },
      { mode: "view", title: "Kusgaon · Daregaon · Walvan · Bhatane", detail: "Scenic village off-road", time: "20 min" },
      { mode: "trek", title: "Kataldhar entry point", detail: "Jungle trek, 3–4 km", time: "1.5 – 2 hrs" },
      { mode: "jeep", title: "Rajmachi base village", detail: "Back to main route via Sumo", time: "30 – 40 min" },
      { mode: "end", title: "Rajmachi Fort", detail: "Shrivardhan & Manoranjan", time: "1 – 1.5 hrs" },
    ],
    info: {
      entryFee: "Free",
      parking: "At base village, ₹50",
      food: "Pithla bhakri, thecha, matki usal",
      water: "Carry your own",
      washrooms: "Basic, at base village",
      network: "Patchy on the trail",
      camping: "Allowed at Rajmachi village",
      guide: "Recommended in monsoon",
    },
    gallery: [realPhotos.kataldharWide, realPhotos.kataldharDrops, realPhotos.lonavalaBhutta],
    googleMapsUrl: "https://www.google.com/maps/dir/Pune/Rajmachi+Fort",
  },
  {
    slug: "visapur-lohagad",
    name: "Visapur & Lohagad Fort",
    tagline: "A perfect monsoon escape",
    district: "Pune",
    state: "Maharashtra",
    categories: ["Forts", "Trekking", "Caves", "Waterfalls"],
    hero: realPhotos.bhajeCaves,
    routeMap: routeVisapur.url,
    lat: 18.7128,
    lng: 73.4831,
    distanceKm: 62,
    travelTime: "1.5 – 2 hrs",
    trekTime: "4 – 5 hrs total",
    trekDistanceKm: 10.5,
    elevationM: 1084,
    difficulty: "Easy to Moderate",
    rating: 4.7,
    season: "June to February",
    weather: "Monsoon: cool 19–25°C with constant drizzle. Winter mornings are crisp and clear.",
    sunrise: "6:08 AM",
    sunset: "7:05 PM",
    visitedOn: "2025-07-27",
    summary:
      "Malavali local, a walk through Bhaje village and its waterfall, ancient Buddhist caves, then a long monsoon ascent across the ridge from Visapur to Lohagad.",
    story:
      "Malavali station on a monsoon morning smells of wet earth and chai. Bhaje village is a twenty minute walk, the waterfall another twenty, and the Buddhist caves sit above it all, cool and silent. The ascent to Visapur is long and open — the plateau feels endless in the mist. Crossing the ridge to Lohagad, the Vinchu Kata tail appears out of the clouds like a spine.",
    highlights: [
      "Bhaje waterfall right beside the trail",
      "2,000-year-old Bhaje Leni Buddhist caves",
      "Visapur's vast misty plateau",
      "Lohagad's Vinchu Kata scorpion tail",
    ],
    carry: ["Good shoes", "Raincoat / poncho", "Water bottle", "Energy snacks", "Power bank", "ID proof"],
    nearby: ["Karla Caves", "Pawna Lake", "Bhushi Dam", "Lonavala"],
    photoSpots: ["Bhaje caves veranda", "Visapur ridge edge", "Lohagad Vinchu Kata", "Malavali station board"],
    tips: [
      "Do Visapur first, Lohagad second — the ridge walk is downhill that way",
      "Total trek is 4–5 hrs, start by 8am",
      "Bhaje caves close by 5:30pm",
    ],
    safety: [
      "Visapur's rock steps are slick in rain",
      "Avoid the plateau edge in strong wind",
      "Stay in a group on the ridge crossing",
    ],
    expenses: [
      { label: "Local ticket (Pune → Lonavala)", amount: "₹30 – 60" },
      { label: "Shared cab to Bhaje", amount: "₹100 – 150" },
      { label: "Food & snacks", amount: "₹150 – 200" },
      { label: "Total per person", amount: "₹300 – 400" },
    ],
    timeline: [
      { mode: "start", title: "Pune", detail: "Board local train towards Lonavala", time: "0:00" },
      { mode: "train", title: "Malavali Station", detail: "Local train, exit same side", time: "60 – 75 min" },
      { mode: "walk", title: "Bhaje Village", detail: "Small village walk from station", time: "15 – 20 min" },
      { mode: "view", title: "Bhaje Waterfall", detail: "Quick scenic halt", time: "20 – 25 min" },
      { mode: "view", title: "Bhaje Leni Caves", detail: "Ancient Buddhist caves", time: "10 – 15 min" },
      { mode: "trek", title: "Visapur Fort", detail: "Long scenic ascent, ~7 km", time: "2.5 – 3.5 hrs" },
      { mode: "end", title: "Lohagad Fort", detail: "Ridge continuation, ~3.5 km", time: "1 – 1.5 hrs" },
    ],
    info: {
      entryFee: "Free (caves ₹25)",
      parking: "Bhaje village, ₹50",
      food: "Village stalls, lemon soda & bhaji",
      water: "Refill at Bhaje village",
      washrooms: "At Bhaje village only",
      network: "Good till Bhaje, weak above",
      camping: "Not permitted on fort",
      guide: "Not required",
    },
    gallery: [realPhotos.bhajeCaves],
    googleMapsUrl: "https://www.google.com/maps/dir/Pune/Lohagad+Fort",
  },
  {
    slug: "pawna-lake",
    name: "Pawna Lake & Amour Café",
    tagline: "Mountains, mist & memories made by the lake",
    district: "Pune",
    state: "Maharashtra",
    categories: ["Camping", "Nature"],
    hero: realPhotos.pawnaTent,
    routeMap: routePawna.url,
    lat: 18.6489,
    lng: 73.4869,
    distanceKm: 65,
    travelTime: "1.5 – 2 hrs",
    trekTime: "No trek",
    trekDistanceKm: 0,
    elevationM: 620,
    difficulty: "Easy",
    rating: 4.5,
    season: "June to February",
    weather: "Cool lake breeze year round; monsoon brings mist over the water and green hills.",
    sunrise: "6:07 AM",
    sunset: "7:08 PM",
    visitedOn: "2025-11-08",
    summary:
      "A scenic expressway drive to a lakeside camp, with kayaking, bonfires and coffee at Amour Café on the banks of Pawna.",
    story:
      "We left Shivajinagar before sunrise, exited at Palaspe Phata, and wound through Dehuroad and Kolvan until the lake opened up. Tents by the water, kayaks in the afternoon, and a bonfire that lasted longer than anyone planned. Amour Café's terrace at sunset is the photograph everyone takes home.",
    highlights: [
      "Lakeside camping with bonfire",
      "Amour Café terrace at sunset",
      "Kayaking and boating on Pawna",
      "Tikona and Tung fort silhouettes across the water",
    ],
    carry: ["Cash", "Jacket", "Power bank", "Snacks", "Torch", "Change of clothes"],
    nearby: ["Tikona Fort", "Tung Fort", "Lohagad", "Kolvan Village"],
    photoSpots: ["Amour Café deck", "Tent row at blue hour", "Lake jetty at sunrise", "Kolvan road bend"],
    tips: [
      "Start early to enjoy the whole day",
      "Carry cash — digital payments are limited",
      "Book camping in advance on weekends",
    ],
    safety: [
      "Do not swim in the lake — depth varies sharply",
      "Keep the bonfire away from tents",
      "Watch the weather before camping in monsoon",
    ],
    expenses: [
      { label: "Travel (to & fro)", amount: "₹150 – 300" },
      { label: "Food (café / meals)", amount: "₹300 – 600" },
      { label: "Activities (optional)", amount: "₹100 – 300" },
      { label: "Total per person", amount: "₹550 – 1,200" },
    ],
    timeline: [
      { mode: "start", title: "Pune (Swargate / Shivajinagar)", detail: "Start by car, bike or bus", time: "0:00" },
      { mode: "bus", title: "Mumbai–Pune Expressway", detail: "Fast scenic stretch", time: "45 min" },
      { mode: "view", title: "Palaspe Phata", detail: "Exit from expressway", time: "10 min" },
      { mode: "view", title: "Dehuroad", detail: "Temple stop en route", time: "15 min" },
      { mode: "view", title: "Kolvan Village", detail: "Green winding village road", time: "20 min" },
      { mode: "end", title: "Pawna Lake & Amour Café", detail: "Camping, kayaking, sunset", time: "Rest of day" },
    ],
    info: {
      entryFee: "Free (camping ₹800+)",
      parking: "Free at campsites",
      food: "Café meals, camp dinner & breakfast",
      water: "Available at campsites",
      washrooms: "At campsites and café",
      network: "Moderate, Jio works best",
      camping: "Yes — the main draw",
      guide: "Not required",
    },
    gallery: [realPhotos.pawnaTent, realPhotos.pawnaEvening],
    googleMapsUrl: "https://www.google.com/maps/dir/Pune/Pawna+Lake",
  },
  {
    slug: "tikona-fort",
    name: "Tikona Fort",
    tagline: "Vitandgad — the triangular monsoon escape",
    district: "Pune",
    state: "Maharashtra",
    categories: ["Forts", "Trekking", "Caves", "Temples"],
    hero: realPhotos.tikonaPeak,
    routeMap: routeTikona.url,
    lat: 18.6167,
    lng: 73.5,
    distanceKm: 29,
    travelTime: "2 – 2.5 hrs",
    trekTime: "1 – 1.5 hrs one way",
    trekDistanceKm: 3,
    elevationM: 1067,
    difficulty: "Easy to Moderate",
    rating: 4.4,
    season: "June to September, October to February",
    weather: "Monsoon mist and green trails; winter offers clear 360° views over Pawna Lake.",
    sunrise: "6:09 AM",
    sunset: "7:04 PM",
    visitedOn: "2025-09-21",
    summary:
      "A beginner-friendly hill fort near Lonavala famous for its triangular shape, stone steps and panoramic views over Pawna Lake.",
    story:
      "Tikona is the fort you take first-timers to. Local to Kamshet, a shared jeep to Tikona Peth, and then a steady climb on stone steps through farms and open hills. The top is small and triangular, with a Trimbakeshwar temple and caves cut into the rock, and Pawna Lake spread out blue below.",
    highlights: [
      "Triangular summit with 360° views",
      "Trimbakeshwar Mahadev temple at the top",
      "Rock-cut water cisterns and caves",
      "Views of Pawna Lake, Lohagad, Tung and Visapur",
    ],
    carry: ["2–3L water", "Snacks / energy bars", "Raincoat", "Trekking shoes", "First aid kit", "Torch"],
    nearby: ["Pawna Lake", "Tung Fort", "Kamshet paragliding", "Bhandara Hill"],
    photoSpots: ["Final stone staircase", "Summit flag point", "Cave entrance", "Pawna Lake overlook"],
    tips: [
      "Start early to avoid crowds",
      "The last stretch of steps is steep — use the railing",
      "Check the weather before you go",
    ],
    safety: [
      "Steps get very slippery in heavy rain",
      "Avoid the summit during lightning",
      "Descend before dark, there is no lighting",
    ],
    expenses: [
      { label: "Pune → Lonavala / Kamshet local", amount: "₹40 – 60" },
      { label: "Shared cab to base village", amount: "₹200 – 350" },
      { label: "Food / snacks", amount: "₹150 – 250" },
      { label: "Total per person", amount: "₹730 – 1,120" },
    ],
    timeline: [
      { mode: "start", title: "Pune", detail: "Start your journey", time: "0:00" },
      { mode: "train", title: "Lonavala / Kamshet Station", detail: "Local train from Pune", time: "1.5 – 2 hrs" },
      { mode: "jeep", title: "Shared cab / jeep", detail: "To Tikona Peth base village", time: "45 – 75 min" },
      { mode: "view", title: "Tikona Base Village", detail: "Park and gear up", time: "15 min" },
      { mode: "trek", title: "Trek to fort", detail: "2.5 – 3 km, stone steps & forest path", time: "1 – 1.5 hrs" },
      { mode: "end", title: "Tikona Fort Top", detail: "3,500 ft — 360° panoramic views", time: "1 hr explore" },
    ],
    info: {
      entryFee: "Free",
      parking: "Base village, ₹30",
      food: "Small stalls at base village",
      water: "Carry 2–3 litres",
      washrooms: "Base village only",
      network: "Weak above the base",
      camping: "Allowed at base village",
      guide: "Not required",
    },
    gallery: [realPhotos.tikonaPeak, realPhotos.tikonaSummit, realPhotos.pawnaFromTikona],
    googleMapsUrl: "https://www.google.com/maps/dir/Pune/Tikona+Fort",
  },
];

export function getDestination(slug: string) {
  return destinations.find((d) => d.slug === slug);
}

/**
 * Every frame below is an original photograph shot on the trip named in it —
 * no stock or AI imagery anywhere on the site.
 */
export const photos: Photo[] = [
  {
    id: "kataldhar-wide",
    src: realPhotos.kataldharWide,
    destination: "Kataldhar Waterfall",
    slug: "kataldhar-rajmachi",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-08-16",
    caption:
      "Kataldhar Waterfall in full monsoon flow, framed by the dense Rajmachi forest on the trek in from Lonavala.",
    tags: ["Waterfalls", "Nature", "Trekking"],
    cover: true,
  },
  {
    id: "kataldhar-drops",
    src: realPhotos.kataldharDrops,
    destination: "Kataldhar Waterfall",
    slug: "kataldhar-rajmachi",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-08-16",
    caption: "The three main drops of Kataldhar up close — roughly 100 m of falling water after a week of rain.",
    tags: ["Waterfalls", "Nature"],
  },
  {
    id: "tikona-peak",
    src: realPhotos.tikonaPeak,
    destination: "Tikona Fort",
    slug: "tikona-fort",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-09-21",
    caption: "The triangular peak of Tikona Fort with the ghat road winding through the valley far below.",
    tags: ["Forts", "Trekking", "Nature"],
    cover: true,
  },
  {
    id: "tikona-summit",
    src: realPhotos.tikonaSummit,
    destination: "Tikona Fort",
    slug: "tikona-fort",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-09-21",
    caption: "Looking up at the Tikona summit block against a monsoon sky, minutes before the final flight of steps.",
    tags: ["Forts", "Trekking"],
  },
  {
    id: "pawna-from-tikona",
    src: realPhotos.pawnaFromTikona,
    destination: "Pawna Lake from Tikona Fort",
    slug: "tikona-fort",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-09-21",
    caption: "Pawna Lake and the Tung–Lohagad ridges seen from the top of Tikona — the view everyone climbs for.",
    tags: ["Nature", "Forts"],
  },
  {
    id: "pawna-tent",
    src: realPhotos.pawnaTent,
    destination: "Pawna Lake",
    slug: "pawna-lake",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-11-08",
    caption: "Our teepee tent pitched a few metres from the Pawna Lake shoreline at sunset.",
    tags: ["Camping", "Nature"],
    cover: true,
  },
  {
    id: "pawna-evening",
    src: realPhotos.pawnaEvening,
    destination: "Pawna Lake",
    slug: "pawna-lake",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-11-08",
    caption: "Blue hour on the Pawna shore — lit tents, still water and the bonfire being started behind us.",
    tags: ["Camping", "Nature"],
  },
  {
    id: "lonavala-bhutta",
    src: realPhotos.lonavalaBhutta,
    destination: "Lonavala",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-08-16",
    caption: "Roasted bhutta on the way back through Lonavala — the unofficial end to every monsoon trek.",
    tags: ["Nature", "Trekking"],
  },
  {
    id: "bhaje-caves",
    src: realPhotos.bhajeCaves,
    destination: "Bhaje (Bhaje Leni) Caves",
    slug: "visapur-lohagad",
    district: "Pune",
    state: "Maharashtra",
    date: "2025-07-27",
    caption: "The stone stairway up to the 2,000-year-old Bhaje Leni Buddhist caves, on the Visapur–Lohagad route.",
    tags: ["Caves", "Temples", "Trekking"],
    cover: true,
  },
];

export type BucketItem = {
  id: string;
  name: string;
  district: string;
  priority: "High" | "Medium" | "Low";
  season: string;
  notes: string;
  status: "Planned" | "Researching" | "Booked" | "Wishlist";
  done: boolean;
};

export const bucketList: BucketItem[] = [
  { id: "harishchandragad", name: "Harishchandragad — Konkankada", district: "Ahmednagar", priority: "High", season: "Oct – Feb", notes: "Night camp at the cave, sunrise at Konkankada.", status: "Planned", done: false },
  { id: "kalsubai", name: "Kalsubai Peak", district: "Ahmednagar", priority: "High", season: "Sep – Jan", notes: "Highest point in Maharashtra, 1,646 m. Ladder sections.", status: "Researching", done: false },
  { id: "andharban", name: "Andharban Jungle Trail", district: "Pune", priority: "Medium", season: "Jun – Sep", notes: "13 km descending forest trail, need an early start.", status: "Planned", done: false },
  { id: "raigad", name: "Raigad Fort", district: "Raigad", priority: "High", season: "Nov – Feb", notes: "1,737 steps or the ropeway. Two-day plan.", status: "Booked", done: false },
  { id: "devkund", name: "Devkund Waterfall", district: "Raigad", priority: "Medium", season: "Jul – Sep", notes: "Guide mandatory, plunge pool is deep.", status: "Planned", done: false },
  { id: "torna", name: "Torna Fort", district: "Pune", priority: "Medium", season: "Oct – Feb", notes: "Shivaji's first fort — long ridge walk.", status: "Researching", done: false },
  { id: "ajanta", name: "Ajanta & Ellora Caves", district: "Aurangabad", priority: "Low", season: "Nov – Feb", notes: "Two full days, hire an official guide.", status: "Planned", done: false },
  { id: "tarkarli", name: "Tarkarli Beach", district: "Sindhudurg", priority: "Medium", season: "Nov – Mar", notes: "Scuba diving and Sindhudurg fort by boat.", status: "Planned", done: false },
  { id: "sinhagad", name: "Sinhagad Fort", district: "Pune", priority: "High", season: "Jul – Feb", notes: "Metro to Swargate, PMPML bus to Donje Phata, 2.5 km historic trail. Pitla-bhakri at the top.", status: "Wishlist", done: false },
  { id: "thoseghar", name: "Thoseghar Falls", district: "Satara", priority: "Medium", season: "Jul – Sep", notes: "Peak roar in late July — reach the viewing deck before 10am.", status: "Wishlist", done: false },
  { id: "randha", name: "Randha Falls", district: "Ahmednagar", priority: "Low", season: "Jul – Sep", notes: "Pair it with Bhandardara lake; spray reaches the path.", status: "Wishlist", done: false },
  { id: "mahabaleshwar", name: "Mahabaleshwar", district: "Satara", priority: "Medium", season: "Oct – Feb", notes: "Arthur's Seat at dawn, strawberries after. Stay outside the market.", status: "Wishlist", done: false },
  { id: "chikhaldara", name: "Chikhaldara", district: "Amravati", priority: "Low", season: "Nov – Feb", notes: "Vidarbha's only hill station — coffee plantations and empty viewpoints.", status: "Wishlist", done: false },
];

export const travelStats = (() => {
  const districts = new Set(destinations.map((d) => d.district));
  const count = (c: Category) => destinations.filter((d) => d.categories.includes(c)).length;
  const recent = [...destinations].sort((a, b) => b.visitedOn.localeCompare(a.visitedOn))[0]!;
  const favourite = [...destinations].sort((a, b) => b.rating - a.rating)[0]!;
  return {
    trips: destinations.length,
    destinations: destinations.length,
    forts: count("Forts"),
    waterfalls: count("Waterfalls"),
    temples: count("Temples"),
    trekDistance: destinations.reduce((s, d) => s + d.trekDistanceKm, 0),
    distanceTravelled: destinations.reduce((s, d) => s + d.distanceKm * 2, 0),
    highestElevation: Math.max(...destinations.map((d) => d.elevationM)),
    photos: photos.length,
    districts: districts.size,
    recent,
    favourite,
  };
})();