/* ===========================================================
   MAGGIE'S COLLECTION — staff desks — js/config.js
   Only what the desks need. The shop has its own, fuller copy
   in its own repository; if you rename a boutique or change the
   categories there, change them here too.
   =========================================================== */

const SUPABASE_URL = "https://einuzgxchmxwxisrrkyn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpbnV6Z3hjaG14d3hpc3Jya3luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MTE1NDAsImV4cCI6MjEwNTQ4NzU0MH0.MvG8G4sXd8809J2rGA-d1RZghewEDC7pFdNlo_Rj3Rg";

const SHOP = {
  name: "Maggie's Collection",
  currency: "KSh",
  /* slug is stored on every product and order: never rename it */
  stores: [
    { slug: "maggies", name: "Maggie's Collection", short: "Maggie's", prefix: "MC" },
    { slug: "davids",  name: "David's Boutique",    short: "David's",  prefix: "DB" }
  ],
  categories: [
    { slug: "dresses", name: "Dresses" },
    { slug: "tops", name: "Tops & shirts" },
    { slug: "bottoms", name: "Trousers & skirts" },
    { slug: "menswear", name: "Menswear" },
    { slug: "kids", name: "Kids & teens" },
    { slug: "ankara", name: "Ankara & prints" },
    { slug: "bags", name: "Bags" },
    { slug: "shoes", name: "Shoes" },
    { slug: "accessories", name: "Accessories" }
  ]
};

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.SHOP = SHOP;
