/* ===========================================================
   MAGGIE'S COLLECTION — staff desks — js/config.js
   Only what the desks need. The shop has its own, fuller copy
   in its own repository; if you rename a boutique or change the
   categories there, change them here too.
   =========================================================== */

const SUPABASE_URL = "https://einuzgxchmxwxisrrkyn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpbnV6Z3hjaG14d3hpc3Jya3luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MTE1NDAsImV4cCI6MjEwNTQ4NzU0MH0.MvG8G4sXd8809J2rGA-d1RZghewEDC7pFdNlo_Rj3Rg";

/* One list of clothing types, used by Women, Men and Kids & teens. */
const CLOTHING_TYPES = [
  { slug: "dresses", name: "Dresses" },
  { slug: "tops", name: "Tops & shirts" },
  { slug: "trousers", name: "Trousers & jeans" },
  { slug: "skirts", name: "Skirts" },
  { slug: "jackets", name: "Jackets & coats" },
  { slug: "sweatshirts", name: "Sweatshirts & hoodies" },
  { slug: "suits", name: "Suits & formalwear" },
  { slug: "activewear", name: "Activewear" },
  { slug: "sleepwear", name: "Sleepwear & underwear" },
  { slug: "african", name: "African wear" }
];

const SHOP = {
  name: "Maggie's Collection",
  currency: "KSh",
  /* slug is stored on every product and order: never rename it */
  stores: [
    { slug: "maggies", name: "Maggie's Collection", short: "Maggie's", prefix: "MC" },
    { slug: "davids",  name: "David's Boutique",    short: "David's",  prefix: "DB" }
  ],
  /* ---- how products are grouped ---------------------------------
     department: who or what it is for (stored on each product)
     types:      what the piece is, inside that department
     Never rename a slug once products use it. Add new types freely.   */
  departments: [
    { slug: "women", name: "Women", types: CLOTHING_TYPES },
    { slug: "men", name: "Men", types: CLOTHING_TYPES },
    { slug: "kids", name: "Kids & teens", types: CLOTHING_TYPES },
    { slug: "shoes", name: "Shoes", types: [
      { slug: "sandals", name: "Sandals" }, { slug: "heels", name: "Heels" },
      { slug: "flats", name: "Flats" }, { slug: "sneakers", name: "Sneakers" },
      { slug: "formal-shoes", name: "Formal shoes" }
    ] },
    { slug: "bags", name: "Bags", types: [
      { slug: "handbags", name: "Handbags" }, { slug: "backpacks", name: "Backpacks" },
      { slug: "travel", name: "Travel & suitcases" }
    ] },
    { slug: "accessories", name: "Accessories", types: [
      { slug: "jewellery", name: "Jewellery" }, { slug: "belts", name: "Belts" },
      { slug: "scarves", name: "Scarves" }, { slug: "caps", name: "Caps & hats" },
      { slug: "watches", name: "Watches" }, { slug: "sunglasses", name: "Sunglasses" }
    ] }
  ]
};

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.SHOP = SHOP;
