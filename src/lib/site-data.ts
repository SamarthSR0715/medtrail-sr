export type NavItem = { to: string; label: string };

export const navItems: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/mbbs", label: "MBBS Hub" },
  { to: "/travel", label: "Travel Journal" },
  { to: "/fitness", label: "Fitness" },
  { to: "/portfolio", label: "Portfolio" },
];

export const socials = {
  instagram: "https://www.instagram.com/samarth_rautrao_07",
  linkedin: "https://www.linkedin.com/in/samarth-rautrao-859804411",
};

export type SearchEntry = { to: string; title: string; group: string; keywords: string };

export const searchIndex: SearchEntry[] = [
  { to: "/", title: "Home overview", group: "Pages", keywords: "start landing medtrail hero" },
  { to: "/mbbs", title: "Study planner", group: "MBBS Hub", keywords: "schedule tasks subjects anatomy" },
  { to: "/mbbs", title: "Notes library", group: "MBBS Hub", keywords: "notes physiology biochem pdf" },
  { to: "/mbbs", title: "Flashcards", group: "MBBS Hub", keywords: "spaced repetition revise cards" },
  { to: "/mbbs", title: "Quizzes", group: "MBBS Hub", keywords: "mcq test exam practice" },
  { to: "/travel", title: "Forts of Maharashtra", group: "Travel Journal", keywords: "raigad sinhagad trek map" },
  { to: "/travel", title: "Waterfalls", group: "Travel Journal", keywords: "monsoon thoseghar kune" },
  { to: "/travel", title: "Hill stations", group: "Travel Journal", keywords: "mahabaleshwar lonavala budget" },
  { to: "/fitness", title: "Workout log", group: "Fitness", keywords: "gym push pull legs sets reps" },
  { to: "/fitness", title: "BMI calculator", group: "Fitness", keywords: "height weight body mass index" },
  { to: "/fitness", title: "Hydration tracker", group: "Fitness", keywords: "water glasses litres" },
  { to: "/fitness", title: "Protein calculator", group: "Fitness", keywords: "protein grams diet veg vegan weight macros" },
  { to: "/fitness", title: "Progress charts", group: "Fitness", keywords: "weight volume graph analytics" },
  { to: "/portfolio", title: "About Samarth", group: "Portfolio", keywords: "bio medical student" },
  { to: "/portfolio", title: "Projects", group: "Portfolio", keywords: "work builds case studies" },
  { to: "/portfolio", title: "Contact", group: "Portfolio", keywords: "email instagram linkedin message" },
];