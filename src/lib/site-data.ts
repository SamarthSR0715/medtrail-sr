export type NavItem = { to: string; label: string };

export const navItems: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/mbbs", label: "MBBS Hub" },
  { to: "/travel", label: "Travel" },
  { to: "/destinations", label: "Destinations" },
  { to: "/travel-map", label: "Map" },
  { to: "/gallery", label: "Gallery" },
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
  { to: "/travel-map", title: "Interactive travel map", group: "Travel Journal", keywords: "map leaflet pins routes pune clusters" },
  { to: "/gallery", title: "Photo gallery", group: "Travel Journal", keywords: "photos masonry lightbox zoom images tags" },
  { to: "/destinations", title: "Destination guides", group: "Travel Journal", keywords: "guides itinerary timeline budget gear" },
  { to: "/destinations/kataldhar-rajmachi", title: "Kataldhar & Rajmachi", group: "Destinations", keywords: "waterfall fort lonavala monsoon trek" },
  { to: "/destinations/visapur-lohagad", title: "Visapur & Lohagad", group: "Destinations", keywords: "malavli bhaje caves train fort" },
  { to: "/destinations/pawna-lake", title: "Pawna Lake & Amour Café", group: "Destinations", keywords: "camping lakeside sunset cafe" },
  { to: "/destinations/tikona-fort", title: "Tikona Fort", group: "Destinations", keywords: "triangular fort pawna quick trek" },
  { to: "/bucket-list", title: "Travel wishlist & bucket list", group: "Travel Journal", keywords: "wishlist coming soon kalsubai harishchandragad mahabaleshwar plans" },
  { to: "/fitness", title: "Workout log", group: "Fitness", keywords: "gym push pull legs sets reps" },
  { to: "/fitness", title: "BMI calculator", group: "Fitness", keywords: "height weight body mass index" },
  { to: "/fitness", title: "Hydration tracker", group: "Fitness", keywords: "water glasses litres" },
  { to: "/fitness", title: "Protein calculator", group: "Fitness", keywords: "protein grams diet veg vegan weight macros" },
  { to: "/fitness", title: "Progress charts", group: "Fitness", keywords: "weight volume graph analytics" },
  { to: "/portfolio", title: "About Samarth", group: "Portfolio", keywords: "bio medical student" },
  { to: "/portfolio", title: "Projects", group: "Portfolio", keywords: "work builds case studies" },
  { to: "/portfolio", title: "Contact", group: "Portfolio", keywords: "email instagram linkedin message" },
];