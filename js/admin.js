/* ===========================================================
   MAGGIE'S COLLECTION — admin.js
   One script, two desks. The page says which one it is with
   <body data-desk="counter | manager">:

     counter   sell at the till, stock, products, website orders
     manager   all of that, plus reports, staff approval,
               voiding till sales and deleting products

   Who may do what is decided by the database (row level security
   and functions in docs/supabase-counter-manager.sql). This file
   only decides what to show; it cannot widen access.

   Numbers: a "sale" is a till sale that has not been voided, or a
   website order that has been VERIFIED and not cancelled. Sales are
   the item subtotal (delivery fees are not sales). Discount given =
   (marked or list price - price charged) x qty.
   =========================================================== */

(function () {
  "use strict";

  const SHOP = window.SHOP;
  const STORES = SHOP.stores;
  const ORD = window.MC_ORDERS;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const MODE = document.body.dataset.desk || "counter";
  const IS_MANAGER = MODE === "manager";
  const LOW_AT = 3;   // this many pieces or fewer counts as "low"

  /* The old role names still work until docs/supabase-single-store-cleanup.sql is run. */
  const roleOf = (role) => (role === "store_admin" ? "counter" : role === "owner" ? "manager" : role);

  const KEYS_READY =
    window.SUPABASE_URL.indexOf("YOUR-PROJECT-REF") === -1 &&
    window.SUPABASE_ANON_KEY.indexOf("YOUR-ANON") === -1;

  const sb = (KEYS_READY && window.supabase)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  /* Password recovery: the link in the reset email brings the person back
     here with "type=recovery" in the address. Note it before the Supabase
     library tidies the address up. */
  let recovering = location.hash.indexOf("type=recovery") !== -1;
  if (sb) {
    sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovering = true;
        if (document.readyState !== "loading") showReset();
      }
    });
  }

  const STATUSES = ["new", "confirmed", "packed", "out for delivery", "delivered", "cancelled"];
  const IMAGE_BUCKET = "product-images";

  const svg = (inner) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";

  const PANES_BASE = [
    { id: "overview", label: "Overview", title: "Overview", icon: svg('<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>') },
    { id: "sell", label: "Sell", title: "Sell at the till", icon: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 11h1M12 11h1M15.5 11h0M8.5 15h1M12 15h1M15.5 15h0"/>') },
    { id: "orders", label: "Orders", title: "Website orders", icon: svg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>') },
    { id: "products", label: "Products", title: "Products", icon: svg('<path d="M3.5 12.5v-8h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2"/>') },
    { id: "stock", label: "Stock", title: "Stock", icon: svg('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>') },
    { id: "sales", label: "Till sales", title: "Till sales", icon: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>') }
  ];

  const PANES = PANES_BASE.concat(IS_MANAGER ? [
    { id: "stats", label: "Reports", title: "Sales and discounts", icon: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>') },
    { id: "staff", label: "Staff", title: "Staff access", icon: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 11v6M14 14h6"/>') }
  ] : []);

  /* --- state ------------------------------------------------------ */

  let me = null;               // { email, role }
  let PRODUCTS = [];
  let ORDERS = [];
  let POS = [];                // till sales
  let STOCK = new Map();       // product id -> Map(size -> qty); no entry = not counted yet
  let MOVES = [];              // recent stock movements
  let STAFF = [];              // everyone with a login, from list_staff_accounts() (manager only)
  let CART = [];               // the sale being rung up
  let payMethod = "cash";
  let editingId = null;
  let editingImageUrl = "";
  let editingGallery = [];

  const ui = {
    pane: "overview",
    period: 30,
    verif: "pending",             // pending | verified | cancelled | all
    status: "all",
    orderQuery: "",
    prodQuery: "",
    sellQuery: "",
    stockQuery: "",
    stockFilter: "all",           // all | low | out | untracked
    salesQuery: ""
  };

  /* --- helpers ---------------------------------------------------- */

  function money(value) {
    return SHOP.currency + " " + Number(value || 0).toLocaleString("en-KE");
  }

  function short(value) {
    const v = Number(value) || 0;
    if (v >= 1000000) return (Math.round(v / 100000) / 10) + "M";
    if (v >= 1000) return (Math.round(v / 100) / 10) + "k";
    return String(v);
  }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  const DEPTS = SHOP.departments;

  function deptName(slug) {
    const d = DEPTS.find((x) => x.slug === slug);
    return d ? d.name : (slug || "Other");
  }

  /* type slugs are shared between Women, Men and Kids & teens */
  function categoryName(slug) {
    for (const d of DEPTS) {
      const t = d.types.find((x) => x.slug === slug);
      if (t) return t.name;
    }
    return slug || "Other";
  }

  /* "Women · Dresses" for any product, including older ones with no department */
  function placeLabel(p) {
    const placed = ORD.placeProduct(p, DEPTS);
    return deptName(placed.department) + " · " + categoryName(placed.type);
  }

  /* what sizes usually go with each department */
  const SIZE_HINTS = {
    women: "Letters (XS\u20135XL), or One size.",
    men: "Letters (XS\u20135XL), or numbers (28\u201346) for trousers.",
    kids: "By age: 2-3Y, 4-5Y, 6-7Y, 8-9Y, 10-11Y, 12-13Y, 14-15Y.",
    unisex: "Letters (XS\u20135XL), or One size.",
    shoes: "EU numbers, for example 36, 37, 38 \u2026 45.",
    bags: "Small, Medium, Large, or Suitcase for travel cases.",
    accessories: "One size, unless it comes in sizes.",
    home: "One size, or the dimensions, for example 6x6 ft or Queen."
  };

  function fillTypes(selected) {
    const dep = DEPTS.find((d) => d.slug === $("#pDepartment").value) || DEPTS[0];
    $("#pCategory").innerHTML = dep.types.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join("");
    if (selected && dep.types.some((t) => t.slug === selected)) $("#pCategory").value = selected;
    $("#pSizesHint").textContent = SIZE_HINTS[dep.slug] || "";
  }

  function note(target, text, good) {
    const el = $(target);
    if (!el) return;
    el.className = "admin-msg " + (good ? "is-good" : "is-bad");
    el.textContent = text;
  }

  let toastTimer = null;
  function flash(text, bad) {
    const t = $("#toast");
    t.textContent = text;
    t.className = "toast is-on" + (bad ? " is-bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast"; }, 2800);
  }

  function when(stamp) {
    if (!stamp) return "";
    const d = new Date(stamp);
    return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" }) +
      " " + d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const sum = (list, pick) => list.reduce((t, x) => t + (Number(pick(x)) || 0), 0);

  const isSale = (o) => !!o.verified_at && o.status !== "cancelled";
  const isWaiting = (o) => !o.verified_at && o.status !== "cancelled";
  const itemsOf = (o) => (Array.isArray(o.items) ? o.items : []);
  const unitsOf = (o) => sum(itemsOf(o), (i) => i.qty);

  /* Every sale, website and till, in one shape. channel: "web" | "till" */
  function saleRecords() {
    const web = ORDERS.filter(isSale).map((o) => Object.assign({}, o, { channel: "web" }));
    const till = POS.filter((s) => !s.voided_at).map((s) => Object.assign({}, s, { channel: "till" }));
    return web.concat(till);
  }

  function summariseSales(records) {
    const sales = sum(records, (r) => r.subtotal);
    return {
      sales: sales,
      count: records.length,
      units: sum(records, unitsOf),
      discount: sum(records, (r) => r.discount_total),
      aov: records.length ? Math.round(sales / records.length) : 0
    };
  }

  const waitingOrders = () => ORDERS.filter(isWaiting);

  function sinceDays(orders, days) {
    const from = startOfDay(new Date());
    from.setDate(from.getDate() - (days - 1));
    return orders.filter((o) => new Date(o.created_at) >= from);
  }

  /* --- sign in ---------------------------------------------------- */

  function showGate(message) {
    $("#gate").hidden = false;
    const desk = $("#desk");
    if (desk) desk.hidden = true;
    if (message) note("#gateMsg", message, false);
  }

  async function enter(user) {
    const { data: staff, error } = await sb
      .from("staff").select("role").eq("user_id", user.id).maybeSingle();

    if (error || !staff) {
      await sb.auth.signOut();
      showGate("Your access is waiting for approval. Ask the manager to approve you, then sign in again.");
      return;
    }
    const role = roleOf(staff.role);
    if (role !== "counter" && role !== "manager") {
      await sb.auth.signOut();
      showGate("This account does not have desk access. Ask the manager.");
      return;
    }
    /* counter staff cannot open the manager desk; a manager who lands on
       the counter page is simply taken to their own desk */
    if (IS_MANAGER && role !== "manager") {
      await sb.auth.signOut();
      showGate("This sign in belongs to the counter. Go back to the staff sign in page and choose Counter.");
      return;
    }
    if (!IS_MANAGER && role === "manager") {
      location.replace("manager.html");
      return;
    }

    me = { email: user.email, role: role };
    showDesk();
  }

  /* --- forgot / reset password ------------------------------------ */

  async function forgotPassword() {
    if (!sb) { note("#gateMsg", "Supabase is not configured yet.", false); return; }
    const email = $("#email").value.trim();
    if (!email) { note("#gateMsg", "Type your email above first, then tap Forgot password.", false); return; }
    note("#gateMsg", "Sending a reset link…", true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error && /rate|limit|seconds/i.test(error.message)) {
      note("#gateMsg", "Too many requests. Wait a few minutes and try again.", false);
      return;
    }
    /* same answer whether or not the email has an account, so nobody can probe for staff emails */
    note("#gateMsg", "If that email has a desk here, a reset link is on its way. Check your inbox and spam folder.", true);
  }

  function showReset() {
    $("#gate").hidden = false;
    const desk = $("#desk");
    if (desk) desk.hidden = true;
    $("#gateForm").hidden = true;
    $("#resetForm").hidden = false;
    $("#gateMsg").textContent = "";
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    const a = $("#newPassword").value;
    const b = $("#newPassword2").value;
    if (a.length < 8) { note("#resetMsg", "Use at least 8 characters.", false); return; }
    if (a !== b) { note("#resetMsg", "The two passwords do not match.", false); return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { note("#resetMsg", "Could not save it: " + error.message, false); return; }
    await sb.auth.signOut();
    recovering = false;
    history.replaceState(null, "", location.pathname);
    $("#resetForm").hidden = true;
    $("#gateForm").hidden = false;
    $("#newPassword").value = "";
    $("#newPassword2").value = "";
    note("#gateMsg", "Password updated. Sign in with your new password.", true);
  }

  async function signIn(event) {
    event.preventDefault();
    if (!sb) {
      note("#gateMsg", "Add your Supabase URL and anon key to js/config.js before signing in.", false);
      return;
    }
    note("#gateMsg", "Checking those details…", true);
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value
    });
    if (error) {
      note("#gateMsg", /not confirmed/i.test(error.message || "")
        ? "Please confirm your email first. Open the link we sent you (check spam too), then sign in."
        : "That email and password did not match. Try again, or use Forgot password. New here? Request access below.", false);
      return;
    }
    $("#gateMsg").textContent = "";
    await enter(data.user);
  }

  async function signOut() {
    if (sb) await sb.auth.signOut();
    me = null; PRODUCTS = []; ORDERS = [];
    showGate("Signed out.");
  }

  function showDesk() {
    mountDesk();
    $("#gate").hidden = true;
    $("#desk").hidden = false;
    $("#who").textContent = me.email + (IS_MANAGER ? " · manager" : " · counter");
    $("#deskName").textContent = STORES[0].name;
    $("#deskKind").textContent = IS_MANAGER ? "Manager" : "Counter";
    $("#topStore").textContent = IS_MANAGER ? "Manager" : "Counter";
    setPane(ui.pane);
    loadData();
  }

  /* --- data --------------------------------------------------------- */

  function indexStock(rows) {
    const map = new Map();
    rows.forEach((r) => {
      if (!map.has(r.product_id)) map.set(r.product_id, new Map());
      map.get(r.product_id).set(r.size || "", Number(r.qty) || 0);
    });
    return map;
  }

  async function loadData() {
    if (!sb) return;
    const [p, o, st, ps, mv] = await Promise.all([
      sb.from("products").select("*").order("sort", { ascending: true }),
      /* max 1000 recent orders and till sales */
      sb.from("orders").select("*").order("created_at", { ascending: false }).limit(1000),
      sb.from("product_stock").select("product_id, size, qty"),
      sb.from("pos_sales").select("*").order("created_at", { ascending: false }).limit(1000),
      sb.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(100)
    ]);
    const failed = p.error || o.error;
    if (failed) {
      note("#deskMsg", "Could not load the desk: " + failed.message + ".", false);
      return;
    }
    const extra = st.error || ps.error || mv.error;
    if (extra) {
      note("#deskMsg", "Stock and till sales are not set up yet. Run docs/supabase-counter-manager.sql in the Supabase SQL editor, then refresh. (" + extra.message + ")", false);
    } else {
      $("#deskMsg").textContent = "";
    }
    if (IS_MANAGER) loadStaff();
    PRODUCTS = p.data || [];
    ORDERS = o.data || [];
    STOCK = indexStock(st.data || []);
    POS = ps.data || [];
    MOVES = mv.data || [];
    renderAll();
  }

  /* --- navigation ----------------------------------------------------- */

  function buildNav() {
    const item = (cls) => PANES.map((p) =>
      `<button type="button" class="${cls}" data-pane="${p.id}">${p.icon}<span>${p.label}</span>${p.id === "orders" || p.id === "staff" || p.id === "stock" ? '<i class="count" hidden></i>' : ""}</button>`
    ).join("");
    $("#sideNav").innerHTML = item("side__link");
    $("#tabbar").innerHTML = item("");
  }

  function setPane(id) {
    ui.pane = id;
    $$("#sideNav [data-pane], #tabbar [data-pane]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.pane === id);
    });
    $$(".pane").forEach((pane) => pane.classList.toggle("is-active", pane.id === "pane-" + id));
    const meta = PANES.find((p) => p.id === id);
    $("#paneTitle").textContent = meta ? meta.title : "";
    window.scrollTo({ top: 0 });
  }

  /* --- charts ----------------------------------------------------------- */

  function niceMax(v) {
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  /* days: [{ date, values:[a] | [a, b] }]  -> grouped bar chart */
  function chartHTML(days) {
    if (days.every((d) => d.values.every((v) => !v))) {
      return '<div class="empty"><b>No sales in this period yet</b>Complete a till sale or verify a website order and it shows up here.</div>';
    }
    const series = days[0].values.length;
    const W = 680, H = 240, L = 44, R = 8, T = 10, B = 26;
    const innerW = W - L - R, innerH = H - T - B;
    const max = niceMax(Math.max(1, ...days.map((d) => Math.max(...d.values))));
    const slot = innerW / days.length;
    const gap = Math.min(6, slot * 0.25);
    const barW = (slot - gap) / series;
    const every = Math.ceil(days.length / 7);

    let out = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sales by day">';
    for (let g = 0; g <= 4; g++) {
      const y = T + innerH - (innerH * g) / 4;
      out += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      out += '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + short((max * g) / 4) + "</text>";
    }
    days.forEach((d, i) => {
      d.values.forEach((v, s) => {
        const h = (v / max) * innerH;
        if (h <= 0) return;
        const x = L + i * slot + gap / 2 + s * barW;
        out += '<rect class="bar-' + (s + 1) + '" x="' + x.toFixed(1) + '" y="' + (T + innerH - h).toFixed(1) +
          '" width="' + Math.max(1, barW - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"><title>' +
          esc(d.date.toLocaleDateString("en-KE", { day: "numeric", month: "short" })) + ": " + esc(money(v)) + "</title></rect>";
      });
      if (i % every === 0) {
        out += '<text x="' + (L + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' +
          esc(d.date.toLocaleDateString("en-KE", { day: "numeric", month: "short" })) + "</text>";
      }
    });
    out += "</svg>";
    return out;
  }

  /* Two series: website sales and till sales. */
  function salesChart(records, days) {
    const today = startOfDay(new Date());
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      list.push({ date: d, key: dayKey(d), values: [0, 0] });
    }
    const at = new Map(list.map((x, i) => [x.key, i]));
    records.forEach((r) => {
      const i = at.get(dayKey(new Date(r.created_at)));
      if (i === undefined) return;
      list[i].values[r.channel === "till" ? 1 : 0] += Number(r.subtotal) || 0;
    });
    const legend = '<div class="legend"><span><i style="background:var(--s1)"></i>Website</span><span><i style="background:var(--s2)"></i>Till</span></div>';
    return chartHTML(list) + legend;
  }

  function hbars(rows) {
    if (!rows.length) return '<div class="empty"><b>Nothing yet</b>Figures appear after your first verified order.</div>';
    const max = Math.max(...rows.map((r) => r.value), 1);
    return '<div class="hbar">' + rows.map((r) => `
      <div class="hbar__row">
        <div class="hbar__top"><b>${esc(r.label)}</b><span>${esc(r.sub)}</span></div>
        <div class="hbar__track"><div class="hbar__fill${r.cls ? " hbar__fill--" + esc(r.cls) : ""}" style="width:${Math.max(3, (r.value / max) * 100).toFixed(1)}%"></div></div>
      </div>`).join("") + "</div>";
  }

  /* --- overview ------------------------------------------------------------ */

  function kpi(label, value, sub, alert) {
    return `<div class="kpi${alert ? " kpi--alert" : ""}"><span class="kpi__label">${esc(label)}</span><span class="kpi__value">${esc(value)}</span><span class="kpi__sub">${esc(sub)}</span></div>`;
  }

  function stockSummary() {
    let low = 0, out = 0, untracked = 0;
    PRODUCTS.filter((p) => p.active).forEach((p) => {
      const s = stockInfo(p);
      if (!s.tracked) untracked++;
      else if (s.out) out++;
      else if (s.low) low++;
    });
    return { low: low, out: out, untracked: untracked };
  }

  function renderOverview() {
    const recs = saleRecords();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const today = summariseSales(sinceDays(recs, 1));
    const month = summariseSales(recs.filter((r) => new Date(r.created_at) >= monthStart));
    const waiting = waitingOrders();
    const stock = stockSummary();
    const attention = stock.low + stock.out;

    $("#ovKpis").innerHTML =
      kpi("Sales today", money(today.sales), today.count + (today.count === 1 ? " sale" : " sales")) +
      kpi("Sales this month", money(month.sales), month.discount ? money(month.discount) + " in discounts" : month.count + (month.count === 1 ? " sale" : " sales")) +
      kpi("Waiting for verification", String(waiting.length), waiting.length ? money(sum(waiting, (o) => o.subtotal)) + " to confirm" : "All caught up", waiting.length > 0) +
      kpi("Stock to look at", String(attention), stock.out + " out · " + stock.low + " low" + (stock.untracked ? " · " + stock.untracked + " not counted yet" : ""), attention > 0);

    $("#ovChart").innerHTML = salesChart(sinceDays(recs, 14), 14);

    const list = waiting.slice(0, 6);
    $("#ovPending").innerHTML = list.length
      ? list.map((o) => `
          <div class="row" style="grid-template-columns:1fr auto">
            <div>
              <div class="row__title">${esc(o.code || o.id)}</div>
              <div class="row__meta">${esc(o.customer_name)} · ${money(o.subtotal)} · ${when(o.created_at)}</div>
            </div>
            <div class="row__acts" style="grid-column:auto">
              <button class="mini mini--go" type="button" data-verify="${esc(o.id)}">Verify</button>
            </div>
          </div>`).join("")
      : '<div class="empty"><b>Nothing waiting</b>New website orders that need verifying will appear here.</div>';
  }

  /* --- products --------------------------------------------------------------- */

  function stockPill(p) {
    const s = stockInfo(p);
    if (!s.tracked) return '<span class="pill">stock not counted</span>';
    if (s.out) return '<span class="pill pill--wait">out of stock</span>';
    if (s.low) return '<span class="pill pill--wait">' + s.total + " left</span>";
    return '<span class="pill pill--done">' + s.total + " in stock</span>";
  }

  function renderProducts() {
    const q = ui.prodQuery.trim().toLowerCase();
    const rows = PRODUCTS.filter((p) =>
      !q || (p.name + " " + placeLabel(p)).toLowerCase().indexOf(q) !== -1);
    const list = $("#productList");

    if (!rows.length) {
      list.innerHTML = q
        ? '<div class="empty"><b>No product matches that search</b>Try part of the name or the category.</div>'
        : '<div class="empty"><b>No products yet</b>Tap Add product to put the first piece on the rail.</div>';
      return;
    }

    list.innerHTML = rows.map((p) => {
      const pct = ORD.discountPct(p.price, p.compare_price);
      return `
        <div class="row">
          ${p.image_url ? `<img class="row__thumb" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<div class="row__thumb"></div>'}
          <div>
            <div class="row__title">${esc(p.name)}${pct ? `<span class="badge badge--off">−${pct}%</span>` : ""}</div>
            <div class="row__meta">
              <span class="row__price">${money(p.price)}${pct ? `<s>${money(p.compare_price)}</s>` : ""}</span> ·
              ${esc(placeLabel(p))} ·
              ${Array.isArray(p.sizes) && p.sizes.length ? esc(p.sizes.join(", ")) : "no sizes"} ·
              ${stockPill(p)} ·
              <span class="pill${p.active ? " pill--new" : ""}">${p.active ? "on the rail" : "hidden"}</span>
            </div>
          </div>
          <div class="row__acts">
            <button class="mini" type="button" data-edit="${esc(p.id)}">Edit</button>
            <button class="mini" type="button" data-stockjump="${esc(p.id)}">Stock</button>
            <button class="mini${p.active ? " mini--on" : ""}" type="button" data-toggle="${esc(p.id)}" data-active="${p.active}">${p.active ? "Hide" : "Show"}</button>
            ${IS_MANAGER ? `<button class="mini mini--danger" type="button" data-delete="${esc(p.id)}">Delete</button>` : ""}
          </div>
        </div>`;
    }).join("");
  }

  function openSheet(product) {
    editingId = product ? product.id : null;
    editingImageUrl = product ? (product.image_url || "") : "";
    editingGallery = product && Array.isArray(product.gallery) ? product.gallery.slice() : [];
    $("#sheetTitle").textContent = product ? "Edit product" : "Add a product";
    $("#sheetMsg").textContent = "";

    $("#pName").value = product ? product.name : "";
    $("#pPrice").value = product ? product.price : "";
    $("#pCompare").value = product && product.compare_price ? product.compare_price : "";
    const placed = product ? ORD.placeProduct(product, DEPTS) : { department: DEPTS[0].slug, type: "" };
    $("#pDepartment").value = placed.department;
    fillTypes(placed.type);
    $("#pDescription").value = product ? (product.description || "") : "";
    $("#pMaterial").value = product ? (product.material || "") : "";
    $("#pDimensions").value = product ? (product.dimensions || "") : "";
    $("#pCare").value = product ? (product.care || "") : "";
    $("#pHighlight").value = product && product.highlight ? product.highlight : "auto";
    $("#pGalleryFiles").value = "";
    $("#pGalleryClear").checked = false;
    $("#pGalleryClearWrap").hidden = !editingGallery.length;
    $("#pGalleryNote").textContent = editingGallery.length
      ? editingGallery.length + " extra photo" + (editingGallery.length === 1 ? "" : "s") + " saved. New ones you pick are added to them."
      : "Pick several at once. They are added to the gallery on the product page.";
    $("#pImageFile").value = "";
    $("#pSizes").value = product && Array.isArray(product.sizes) ? product.sizes.join(", ") : "";
    $("#pSort").value = product ? (product.sort || 0) : 0;
    $("#pActive").checked = product ? !!product.active : true;
    $("#saveProduct").textContent = product ? "Save changes" : "Add product";

    $("#pImagePreview").src = editingImageUrl;
    $("#pImagePreviewWrap").hidden = !editingImageUrl;
    previewOffer();

    $("#productSheet").hidden = false;
    $("#sheetScrim").hidden = false;
    document.body.classList.add("is-locked");
    $("#pName").focus();
  }

  function closeSheet() {
    $("#productSheet").hidden = true;
    $("#sheetScrim").hidden = true;
    document.body.classList.remove("is-locked");
  }

  function previewOffer() {
    const box = $("#pOffer");
    const price = Number($("#pPrice").value);
    const compare = Number($("#pCompare").value);
    if (!compare) {
      box.className = "offer-preview";
      box.textContent = "Add a marked price higher than the selling price to show a discount badge.";
    } else if (!(compare > price)) {
      box.className = "offer-preview is-bad";
      box.textContent = "The marked price must be higher than the selling price. Clear it to sell without a discount.";
    } else {
      box.className = "offer-preview is-on";
      box.textContent = "Customers see −" + ORD.discountPct(price, compare) + "% and save " + money(compare - price) + ".";
    }
  }

  /* Uploads the chosen file to the product-images bucket and returns
     its public URL. Each file gets a unique name so re-uploading
     never collides with a photo still used by another product. */
  async function uploadProductImage(file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = Date.now() + "-" + Math.floor(Math.random() * 1e6) + "-" + safeName;
    const uploaded = await sb.storage.from(IMAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
    if (uploaded.error) throw uploaded.error;
    return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (!sb) { note("#sheetMsg", "Add your Supabase keys to js/config.js first.", false); return; }

    const price = Number($("#pPrice").value);
    const compare = Number($("#pCompare").value);
    const name = $("#pName").value.trim();

    if (!name || !price) { note("#sheetMsg", "A product needs a name and a selling price.", false); return; }
    if (compare && !(compare > price)) {
      note("#sheetMsg", "The marked price must be higher than the selling price, or leave it empty.", false);
      return;
    }

    let imageUrl = editingImageUrl;
    const file = $("#pImageFile").files[0];
    if (file) {
      note("#sheetMsg", "Uploading photo…", true);
      try { imageUrl = await uploadProductImage(file); }
      catch (err) { note("#sheetMsg", "Photo upload failed: " + err.message, false); return; }
    }

    let gallery = $("#pGalleryClear").checked ? [] : editingGallery.slice();
    const extra = Array.from($("#pGalleryFiles").files || []);
    if (extra.length) {
      note("#sheetMsg", "Uploading " + extra.length + " more photo" + (extra.length === 1 ? "" : "s") + "…", true);
      try {
        for (const f of extra) gallery.push(await uploadProductImage(f));
      } catch (err) { note("#sheetMsg", "Photo upload failed: " + err.message, false); return; }
    }

    const highlight = $("#pHighlight").value;
    const payload = {
      name: name,
      price: price,
      compare_price: compare || null,
      department: $("#pDepartment").value,
      category: $("#pCategory").value,
      description: $("#pDescription").value.trim(),
      image_url: imageUrl,
      gallery: gallery,
      material: $("#pMaterial").value.trim() || null,
      dimensions: $("#pDimensions").value.trim() || null,
      care: $("#pCare").value.trim() || null,
      highlight: highlight === "auto" ? null : highlight,
      sizes: $("#pSizes").value.split(",").map((s) => s.trim()).filter(Boolean),
      sort: Number($("#pSort").value) || 0,
      active: $("#pActive").checked
    };

    if (!editingId) payload.store = STORES[0].slug;

    const result = editingId
      ? await sb.from("products").update(payload).eq("id", editingId)
      : await sb.from("products").insert(payload);

    if (result.error) { note("#sheetMsg", "Save failed: " + result.error.message, false); return; }
    closeSheet();
    flash(editingId ? "Changes saved" : name + " is on the rail");
    loadData();
  }

  async function toggleProduct(id, isActive) {
    const { error } = await sb.from("products").update({ active: !isActive }).eq("id", id);
    if (error) { flash("Could not change that: " + error.message, true); return; }
    flash(isActive ? "Hidden from the rail" : "Back on the rail");
    loadData();
  }

  async function deleteProduct(id) {
    if (!IS_MANAGER) return;
    const row = PRODUCTS.find((p) => String(p.id) === String(id));
    const name = row ? row.name : "this product";
    if (!window.confirm("Delete " + name + " for good? Hiding it keeps the record instead.")) return;
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) { flash("Delete failed: " + error.message, true); return; }
    flash(name + " deleted");
    loadData();
  }

  /* --- orders ------------------------------------------------------------------ */

  function orderCard(o) {
    const items = itemsOf(o);
    const verified = !!o.verified_at;
    const cls = o.status === "cancelled" ? " is-cancelled" : verified ? " is-verified" : "";
    const saved = Number(o.discount_total) || 0;
    const wa = "https://wa.me/" + ORD.waPhone(o.customer_phone) + "?text=" +
      encodeURIComponent("Hi " + o.customer_name + ", this is " + STORES[0].name + " about your order " + (o.code || "") + ".");

    return `
      <article class="order${cls}">
        <div class="order__head">
          <div class="order__tags">
            <span class="order__code">${esc(o.code || o.id)}</span>
            <span class="pill${o.status === "new" ? " pill--new" : ""}${o.status === "delivered" ? " pill--done" : ""}">${esc(o.status)}</span>
            ${o.stock_deducted ? '<span class="pill pill--done" title="These pieces were taken out of stock when the order was verified">Stock updated</span>' : ""}
          </div>
          <span class="order__when">${when(o.created_at)}</span>
        </div>
        <p class="order__who"><b>${esc(o.customer_name)}</b> <span>· ${esc(o.customer_phone)} · ${esc(o.customer_location)}${o.zone ? " · " + esc(o.zone) : ""}</span></p>
        <ul class="order__items">
          ${items.map((i) => `
            <li>
              <span>${esc(i.qty)} × ${esc(i.name)}${i.size ? " (" + esc(i.size) + ")" : ""}</span>
              <span>${money(Number(i.price) * Number(i.qty))}${Number(i.compare_price) > Number(i.price) ? `<s>${money(Number(i.compare_price) * Number(i.qty))}</s>` : ""}</span>
            </li>`).join("")}
        </ul>
        <div class="order__money">
          <span>Items <b>${money(o.subtotal)}</b></span>
          <span>Delivery <b>${o.delivery_fee ? money(o.delivery_fee) : "free"}</b></span>
          <span>Total <b>${money(o.total)}</b></span>
          ${saved ? `<span>Customer saved <b>${money(saved)}</b></span>` : ""}
        </div>
        ${o.notes ? `<p class="order__note">Notes: ${esc(o.notes)}</p>` : ""}
        <div class="order__acts">
          ${verified
            ? `<span class="order__stamp">Verified${o.verified_by ? " by " + esc(o.verified_by) : ""} · ${when(o.verified_at)}</span>
               <button class="mini" type="button" data-unverify="${esc(o.id)}">Undo</button>`
            : (o.status === "cancelled" ? "" : `<button class="mini mini--go" type="button" data-verify="${esc(o.id)}">Verify order</button>`)}
          <select class="mini" data-status="${esc(o.id)}" aria-label="Order status">
            ${STATUSES.map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${s}</option>`).join("")}
          </select>
          ${o.status === "cancelled" ? `<button class="mini mini--danger" type="button" data-delete-order="${esc(o.id)}">Delete</button>` : ""}
          ${ORD.waPhone(o.customer_phone).length >= 11 ? `<a class="mini" href="${esc(wa)}" target="_blank" rel="noopener">Message customer</a>` : ""}
        </div>
      </article>`;
  }

  function renderOrders() {
    const all = ORDERS;
    const waiting = all.filter(isWaiting).length;

    const modes = [
      { id: "pending", label: "Waiting for verification", count: waiting },
      { id: "verified", label: "Verified", count: 0 },
      { id: "cancelled", label: "Cancelled", count: 0 },
      { id: "all", label: "All orders", count: 0 }
    ];
    $("#verifSwitch").innerHTML = modes.map((m) =>
      `<button type="button" class="${ui.verif === m.id ? "is-active" : ""}" data-verif="${m.id}">${m.label}${m.count ? ` <span class="count">${m.count}</span>` : ""}</button>`
    ).join("");

    const q = ui.orderQuery.trim().toLowerCase();
    const shown = all.filter((o) => {
      if (ui.verif === "pending" && !isWaiting(o)) return false;
      if (ui.verif === "verified" && !o.verified_at) return false;
      if (ui.verif === "cancelled" && o.status !== "cancelled") return false;
      if (ui.status !== "all" && o.status !== ui.status) return false;
      if (q && (String(o.code) + " " + o.customer_name + " " + o.customer_phone).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    $("#orderList").innerHTML = shown.length
      ? shown.map(orderCard).join("")
      : (ui.verif === "pending" && !q && ui.status === "all"
          ? '<div class="empty"><b>Nothing waiting for verification</b>New orders show up here the moment a customer sends one.</div>'
          : '<div class="empty"><b>No orders match</b>Change the filter or clear the search.</div>');
  }

  async function patchOrder(id, patch, message) {
    const { error } = await sb.from("orders").update(patch).eq("id", id);
    if (error) { flash("Could not update: " + error.message, true); return false; }
    const row = ORDERS.find((o) => String(o.id) === String(id));
    if (row) Object.assign(row, patch);
    renderAll();
    flash(message);
    if (patch.status === "cancelled") loadData();   // a cancelled verified order puts its stock back
    return true;
  }

  /* Only cancelled orders can be deleted (the database enforces this too),
     so a real sale can never be wiped by a mis-tap. To remove a test order,
     set it to "cancelled" first. */
  async function deleteOrder(id) {
    const row = ORDERS.find((o) => String(o.id) === String(id));
    if (!row || row.status !== "cancelled") { flash("Set the order to cancelled first.", true); return; }
    if (!window.confirm("Delete order " + (row.code || "") + " for good? This cannot be undone.")) return;
    const { error } = await sb.from("orders").delete().eq("id", id);
    if (error) { flash("Could not delete: " + error.message, true); return; }
    ORDERS = ORDERS.filter((o) => String(o.id) !== String(id));
    renderAll();
    flash("Order deleted");
  }

  /* Verifying takes the pieces out of stock in the same step (database function).
     If a piece is short, ask before forcing it through. */
  async function verifyOrder(id, force) {
    const { error } = await sb.rpc("verify_order", { p_order: id, p_force: !!force });
    if (error) {
      if (!force && /not enough stock/i.test(error.message)) {
        if (window.confirm(error.message + ".\n\nVerify anyway? Stock will go down to what is left.")) return verifyOrder(id, true);
        return;
      }
      const hint = /function|schema cache/i.test(error.message) ? " Run docs/supabase-counter-manager.sql first." : "";
      flash("Could not verify: " + error.message + hint, true);
      return;
    }
    flash("Order verified");
    await loadData();
  }

  async function unverifyOrder(id) {
    const { error } = await sb.rpc("unverify_order", { p_order: id });
    if (error) { flash("Could not undo: " + error.message, true); return; }
    flash("Verification removed. Stock put back.");
    await loadData();
  }

  function setVerified(id, on) {
    return on ? verifyOrder(id, false) : unverifyOrder(id);
  }

  /* --- stats --------------------------------------------------------------------- */

  function renderStats() {
    if (!IS_MANAGER) return;
    const recs = sinceDays(saleRecords(), ui.period);
    const sm = summariseSales(recs);
    const web = summariseSales(recs.filter((r) => r.channel === "web"));
    const till = summariseSales(recs.filter((r) => r.channel === "till"));

    $("#periodSwitch").innerHTML = [7, 30, 90].map((d) =>
      `<button type="button" class="${ui.period === d ? "is-active" : ""}" data-period="${d}">Last ${d} days</button>`).join("");

    $("#stKpis").innerHTML =
      kpi("Sales", money(sm.sales), sm.units + (sm.units === 1 ? " piece sold" : " pieces sold")) +
      kpi("Number of sales", String(sm.count), web.count + " website · " + till.count + " till") +
      kpi("Average sale", money(sm.aov), "items only, no delivery") +
      kpi("Discounts given", money(sm.discount), sm.sales + sm.discount ? Math.round((sm.discount / (sm.sales + sm.discount)) * 100) + "% of marked value" : "none yet");

    $("#stChart").innerHTML = salesChart(recs, ui.period);

    const rate = (x) => (x.sales + x.discount ? Math.round((x.discount / (x.sales + x.discount)) * 100) + "%" : "0%");
    const lines = [
      ["Sales", (x) => money(x.sales)],
      ["Number of sales", (x) => x.count],
      ["Pieces sold", (x) => x.units],
      ["Average sale", (x) => money(x.aov)],
      ["Discounts given", (x) => money(x.discount)],
      ["Discount as share of marked value", rate]
    ];
    const total = web.sales + till.sales;
    const pctWeb = total ? Math.round((web.sales / total) * 100) : 0;
    $("#stCompare").innerHTML = `
      <table class="compare">
        <thead><tr><th></th><th>Website</th><th>Till</th><th>Combined</th></tr></thead>
        <tbody>
          ${lines.map((l) => `<tr><td>${l[0]}</td><td>${l[1](web)}</td><td>${l[1](till)}</td><td>${l[1](sm)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="share" role="img" aria-label="Share of sales"><span style="width:${pctWeb}%"></span><span style="width:${total ? 100 - pctWeb : 0}%"></span></div>
      <div class="legend"><span><i style="background:var(--s1)"></i>Website ${total ? pctWeb : 0}%</span><span><i style="background:var(--s2)"></i>Till ${total ? 100 - pctWeb : 0}%</span></div>`;

    /* best sellers */
    const byProduct = new Map();
    recs.forEach((r) => itemsOf(r).forEach((i) => {
      const key = String(i.id || i.name);
      const row = byProduct.get(key) || { name: i.name, qty: 0, revenue: 0 };
      row.qty += Number(i.qty) || 0;
      row.revenue += (Number(i.price) || 0) * (Number(i.qty) || 0);
      byProduct.set(key, row);
    }));
    $("#stTop").innerHTML = hbars(
      Array.from(byProduct.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6).map((r) => ({
        label: r.name,
        value: r.revenue,
        sub: r.qty + " sold · " + money(r.revenue)
      })));

    /* departments */
    const deptOf = new Map(PRODUCTS.map((p) => [String(p.id), ORD.placeProduct(p, DEPTS).department]));
    const byCat = new Map();
    recs.forEach((r) => itemsOf(r).forEach((i) => {
      const name = deptName(deptOf.get(String(i.id)) || "");
      byCat.set(name, (byCat.get(name) || 0) + (Number(i.price) || 0) * (Number(i.qty) || 0));
    }));
    $("#stCats").innerHTML = hbars(
      Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).map((e) => ({ label: e[0], value: e[1], sub: money(e[1]) })));
  }

  /* --- staff access (manager desk only) -------------------------------------------------- */

  async function loadStaff() {
    if (!IS_MANAGER || !sb) return;
    const { data, error } = await sb.rpc("list_staff_accounts");
    if (error) {
      const hint = /function|does not exist|schema cache/i.test(error.message)
        ? " Run docs/supabase-staff-approval.sql in the Supabase SQL editor first." : "";
      note("#staffMsg", "Could not load staff: " + error.message + "." + hint, false);
      return;
    }
    $("#staffMsg").textContent = "";
    STAFF = data || [];
    renderStaff();
  }

  function pendingRow(a) {
    const ok = !!a.confirmed_at;
    return `
      <div class="row" style="grid-template-columns:1fr">
        <div>
          <div class="row__title">${esc(a.account_email)}
            <span class="pill ${ok ? "pill--done" : "pill--wait"}">${ok ? "Email confirmed" : "Email not confirmed yet"}</span>
          </div>
          <div class="row__meta">Asked ${when(a.created_at)}${ok ? "" : " · they must tap the link in their email first"}</div>
        </div>
        <div class="row__acts" style="grid-column:auto">
          <select class="mini" data-approve-role="${esc(a.account_id)}" aria-label="Role for ${esc(a.account_email)}"${ok ? "" : " disabled"}>
            <option value="counter">Counter staff</option>
            <option value="manager">Manager</option>
          </select>
          <button class="mini mini--go" type="button" data-approve="${esc(a.account_id)}"${ok ? "" : " disabled"}>Approve</button>
        </div>
      </div>`;
  }

  function activeRow(a) {
    const mine = me && a.account_email === me.email;
    const manager = roleOf(a.staff_role) === "manager";
    return `
      <div class="row" style="grid-template-columns:1fr">
        <div>
          <div class="row__title">${esc(a.account_email)}${mine ? ' <span class="pill">You</span>' : ""}
            <span class="pill ${manager ? "pill--new" : ""}">${manager ? "Manager" : "Counter"}</span>
          </div>
          <div class="row__meta">${manager ? "Manager · full access" : "Counter staff · sell, stock, products, orders"} · ${a.last_sign_in ? "last sign in " + when(a.last_sign_in) : "has not signed in yet"}</div>
        </div>
        ${manager ? "" : `
        <div class="row__acts" style="grid-column:auto">
          <button class="mini" type="button" data-make-manager="${esc(a.account_id)}">Make manager</button>
          <button class="mini" type="button" data-reset-staff="${esc(a.account_id)}">Send reset link</button>
          <button class="mini mini--danger" type="button" data-remove-staff="${esc(a.account_id)}">Remove access</button>
        </div>`}
      </div>`;
  }

  function renderStaff() {
    if (!IS_MANAGER) return;
    const waiting = STAFF.filter((a) => !a.staff_role);
    const active = STAFF.filter((a) => a.staff_role);
    $("#staffPending").innerHTML = waiting.length
      ? waiting.map(pendingRow).join("")
      : '<div class="empty"><b>Nobody is waiting</b>When someone asks for access, they appear here.</div>';
    $("#staffActive").innerHTML = active.length
      ? active.map(activeRow).join("")
      : '<div class="empty"><b>No staff yet</b></div>';
    $$('[data-pane="staff"] .count').forEach((el) => {
      el.textContent = waiting.length;
      el.hidden = waiting.length === 0;
    });
  }

  const staffRow = (id) => STAFF.find((a) => String(a.account_id) === String(id));

  async function approveStaff(id, role) {
    const who = staffRow(id);
    const asRole = role === "manager" ? "manager" : "counter";
    if (asRole === "manager" && !window.confirm("Make " + (who ? who.account_email : "this person") + " a manager? Managers can see reports, delete products, void sales and approve staff.")) return;
    const { error } = await sb.rpc("approve_staff", { p_user: id, p_role: asRole });
    if (error) {
      const hint = /function|schema cache/i.test(error.message) ? " Run docs/supabase-counter-manager.sql first." : "";
      flash(error.message + hint, true);
      return;
    }
    flash((who ? who.account_email : "Done") + (asRole === "manager" ? " is now a manager" : " is now counter staff"));
    loadStaff();
  }

  async function removeStaff(id) {
    const who = staffRow(id);
    if (!window.confirm("Remove desk access for " + (who ? who.account_email : "this person") + "? Their login stays, but opens nothing.")) return;
    const { error } = await sb.rpc("remove_staff", { p_user: id });
    if (error) { flash(error.message, true); return; }
    flash("Access removed");
    loadStaff();
  }

  async function resetStaff(id) {
    const who = staffRow(id);
    if (!who) return;
    const { error } = await sb.auth.resetPasswordForEmail(who.account_email, {
      redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "counter.html")
    });
    if (error) { flash(/rate|limit|seconds/i.test(error.message) ? "Too many emails just now. Try again in a few minutes." : error.message, true); return; }
    flash("Reset link sent to " + who.account_email);
  }

  /* =========================================================================
     STOCK
     A product is "counted" once it has rows in product_stock. Until then it
     sells freely and nothing is deducted. Every change goes through the
     database functions (adjust_stock, set_stock, record_pos_sale,
     verify_order), so the till and the website can never oversell.
     ========================================================================= */

  /* the sizes to show for a product: its own sizes, plus any extra size already in stock */
  function sizesOf(p) {
    const base = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.slice() : [""];
    const have = STOCK.get(p.id);
    if (have) have.forEach((_, size) => { if (base.indexOf(size) === -1) base.push(size); });
    return base;
  }

  function stockInfo(p) {
    const have = STOCK.get(p.id);
    const sizes = sizesOf(p);
    if (!have) return { tracked: false, total: 0, out: false, low: false, rows: sizes.map((s) => ({ size: s, qty: null })) };
    const rows = sizes.map((s) => ({ size: s, qty: have.get(s) || 0 }));
    const total = sum(rows, (r) => r.qty);
    return { tracked: true, total: total, out: total === 0, low: total > 0 && total <= LOW_AT, rows: rows };
  }

  const REASONS = {
    opening: "Opening count", restock: "Received stock", correction: "Count correction", damaged: "Damaged or lost",
    return: "Customer return", sale_pos: "Till sale", sale_web: "Website sale", void: "Sale voided", cancelled_order: "Order cancelled"
  };

  function renderStock() {
    const q = ui.stockQuery.trim().toLowerCase();
    const all = PRODUCTS.map((p) => ({ p: p, s: stockInfo(p) }));
    const counts = {
      all: all.length,
      low: all.filter((x) => x.s.tracked && x.s.low).length,
      out: all.filter((x) => x.s.tracked && x.s.out).length,
      untracked: all.filter((x) => !x.s.tracked).length
    };
    const filters = [["all", "All"], ["low", "Low"], ["out", "Out of stock"], ["untracked", "Not counted yet"]];
    $("#stockFilter").innerHTML = filters.map((f) =>
      `<button type="button" class="${ui.stockFilter === f[0] ? "is-active" : ""}" data-stockfilter="${f[0]}">${f[1]} <span class="count">${counts[f[0]]}</span></button>`).join("");

    const rows = all.filter((x) => {
      if (ui.stockFilter === "low" && !(x.s.tracked && x.s.low)) return false;
      if (ui.stockFilter === "out" && !(x.s.tracked && x.s.out)) return false;
      if (ui.stockFilter === "untracked" && x.s.tracked) return false;
      return !q || (x.p.name + " " + placeLabel(x.p)).toLowerCase().indexOf(q) !== -1;
    });

    $("#stockList").innerHTML = rows.length
      ? rows.map((x) => stockBlock(x.p, x.s)).join("")
      : '<div class="empty"><b>Nothing here</b>Change the filter or clear the search.</div>';

    $("#stockMoves").innerHTML = MOVES.length
      ? MOVES.slice(0, 40).map((m) => {
          const p = PRODUCTS.find((x) => String(x.id) === String(m.product_id));
          return `
            <div class="move">
              <b class="move__delta ${m.delta > 0 ? "is-up" : "is-down"}">${m.delta > 0 ? "+" : ""}${m.delta}</b>
              <div>
                <div class="row__title">${esc(p ? p.name : "Removed product")}${m.size ? " (" + esc(m.size) + ")" : ""}</div>
                <div class="row__meta">${esc(REASONS[m.reason] || m.reason)}${m.ref ? " · " + esc(m.ref) : ""}${m.note ? " · " + esc(m.note) : ""} · ${esc(m.by_email || "")} · ${when(m.created_at)}</div>
              </div>
            </div>`;
        }).join("")
      : '<div class="empty"><b>No movements yet</b>Counts, restocks and sales will be listed here.</div>';
  }

  function stockBlock(p, s) {
    const head = `
      <div class="stockhead">
        ${p.image_url ? `<img class="row__thumb" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<div class="row__thumb"></div>'}
        <div>
          <div class="row__title">${esc(p.name)} ${stockPill(p)}</div>
          <div class="row__meta">${money(p.price)} · ${esc(placeLabel(p))}</div>
        </div>
      </div>`;

    if (!s.tracked) {
      return `
        <article class="panel stockbox" data-pid="${esc(p.id)}">
          ${head}
          <p class="hint">Not counted yet, so it sells freely and nothing is deducted. Enter how many you have, then start counting.</p>
          <div class="stockopen">
            ${s.rows.map((r) => `
              <label class="field"><span>${esc(r.size || "Quantity")}</span>
                <input type="number" min="0" step="1" inputmode="numeric" value="0" data-open-size="${esc(r.size)}"></label>`).join("")}
          </div>
          <button class="mini mini--go" type="button" data-startcount="${esc(p.id)}">Start counting</button>
        </article>`;
    }

    return `
      <article class="panel stockbox" data-pid="${esc(p.id)}">
        ${head}
        ${s.rows.map((r) => `
          <div class="stockrow" data-pid="${esc(p.id)}" data-size="${esc(r.size)}">
            <b class="stockrow__size">${esc(r.size || "All")}</b>
            <span class="stockrow__qty${r.qty === 0 ? " is-zero" : r.qty <= LOW_AT ? " is-low" : ""}">${r.qty}</span>
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="qty" aria-label="Quantity">
            <select aria-label="Reason">
              <option value="restock">Received stock</option>
              <option value="return">Customer return</option>
              <option value="damaged">Damaged or lost</option>
              <option value="correction">Count correction</option>
            </select>
            <button class="mini mini--go" type="button" data-stock-act="add">Add</button>
            <button class="mini" type="button" data-stock-act="remove">Remove</button>
            <button class="mini" type="button" data-stock-act="set" title="Set the exact count">Set to</button>
          </div>`).join("")}
      </article>`;
  }

  async function stockRpc(name, args, message) {
    const { error } = await sb.rpc(name, args);
    if (error) {
      const hint = /function|schema cache/i.test(error.message) ? " Run docs/supabase-counter-manager.sql first." : "";
      flash(error.message + hint, true);
      return false;
    }
    flash(message);
    await loadData();
    return true;
  }

  async function stockAction(row, kind) {
    const input = row.querySelector("input");
    const n = Number(input.value);
    const reason = row.querySelector("select").value;
    const base = { p_product: row.dataset.pid, p_size: row.dataset.size };
    if (kind === "set") {
      if (input.value === "" || !(n >= 0)) { flash("Type the exact count first.", true); return; }
      return stockRpc("set_stock", Object.assign(base, { p_qty: Math.floor(n), p_note: null }), "Count saved");
    }
    if (!(n > 0)) { flash("Type how many first.", true); return; }
    const qty = Math.floor(n);
    if (kind === "add") {
      return stockRpc("adjust_stock", Object.assign(base, { p_delta: qty, p_reason: reason === "return" ? "return" : reason === "restock" ? "restock" : "correction", p_note: null }), qty + " added");
    }
    return stockRpc("adjust_stock", Object.assign(base, { p_delta: -qty, p_reason: reason === "damaged" ? "damaged" : "correction", p_note: null }), qty + " removed");
  }

  async function startCount(pid) {
    const box = document.querySelector('.stockbox[data-pid="' + pid + '"]');
    if (!box) return;
    const inputs = Array.from(box.querySelectorAll("[data-open-size]"));
    for (const input of inputs) {
      const n = Number(input.value);
      if (!(n >= 0)) { flash("Counts cannot be below zero.", true); return; }
    }
    for (const input of inputs) {
      const { error } = await sb.rpc("set_stock", { p_product: pid, p_size: input.dataset.openSize, p_qty: Math.floor(Number(input.value)), p_note: null });
      if (error) { flash(error.message, true); return; }
    }
    flash("Counting started");
    await loadData();
  }

  /* =========================================================================
     SELL (the till)
     ========================================================================= */

  const PAY = [["cash", "Cash"], ["mpesa", "M-Pesa"], ["card", "Card"], ["other", "Other"]];
  const cartTotal = () => sum(CART, (l) => l.price * l.qty);
  const cartSaving = () => sum(CART, (l) => Math.max(l.mark - l.price, 0) * l.qty);

  function renderSell() {
    const q = ui.sellQuery.trim().toLowerCase();
    const rows = PRODUCTS.filter((p) => p.active &&
      (!q || (p.name + " " + placeLabel(p)).toLowerCase().indexOf(q) !== -1)).slice(0, 60);

    $("#sellTiles").innerHTML = rows.length
      ? rows.map((p) => {
          const s = stockInfo(p);
          const pct = ORD.discountPct(p.price, p.compare_price);
          const chips = s.rows.map((r) => {
            const out = s.tracked && r.qty <= 0;
            const label = r.size
              ? r.size + (s.tracked ? " · " + r.qty : "")
              : "Add" + (s.tracked ? " · " + r.qty : "");
            return `<button type="button" class="chip${out ? " is-out" : ""}" data-add="${esc(p.id)}" data-size="${esc(r.size)}"${out ? " disabled" : ""}>${esc(label)}</button>`;
          }).join("");
          return `
            <article class="tile">
              ${p.image_url ? `<img class="tile__img" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<div class="tile__img"></div>'}
              <div class="tile__body">
                <div class="row__title">${esc(p.name)}</div>
                <div class="row__meta"><span class="row__price">${money(p.price)}${pct ? `<s>${money(p.compare_price)}</s>` : ""}</span> ${s.tracked ? "" : '<span class="pill">stock not counted</span>'}</div>
                <div class="chips">${chips}</div>
              </div>
            </article>`;
        }).join("")
      : '<div class="empty"><b>No pieces found</b>Only products on the rail can be sold. Check the spelling, or show the product from Products.</div>';

    renderCart();
  }

  function addToCart(id, size) {
    const p = PRODUCTS.find((x) => String(x.id) === String(id));
    if (!p) return;
    const s = stockInfo(p);
    const row = s.rows.find((r) => r.size === size);
    const have = s.tracked ? (row ? row.qty : 0) : Infinity;
    const line = CART.find((l) => String(l.id) === String(p.id) && l.size === size);
    const next = (line ? line.qty : 0) + 1;
    if (next > have) { flash("Only " + have + " left in stock.", true); return; }
    if (line) line.qty = next;
    else CART.push({ id: p.id, name: p.name, size: size, qty: 1, list: Number(p.price), mark: Number(p.compare_price) || Number(p.price), price: Number(p.price) });
    $("#receipt").hidden = true;
    renderCart();
  }

  function cartLine(key) {
    return CART.find((l) => l.id + "|" + l.size === key);
  }

  function renderCart() {
    $("#cartLines").innerHTML = CART.length
      ? CART.map((l) => {
          const key = l.id + "|" + l.size;
          return `
            <div class="cartline" data-key="${esc(key)}">
              <div class="cartline__name"><b>${esc(l.name)}</b>${l.size ? ` <span class="pill">${esc(l.size)}</span>` : ""}</div>
              <div class="cartline__qty">
                <button type="button" class="mini" data-cart-dec="${esc(key)}" aria-label="One less">−</button>
                <b>${l.qty}</b>
                <button type="button" class="mini" data-cart-inc="${esc(key)}" aria-label="One more">+</button>
              </div>
              <label class="cartline__price"><span>Price each</span><input type="number" min="0" step="10" inputmode="numeric" value="${l.price}" data-cart-price="${esc(key)}"></label>
              <b class="cartline__sum">${money(l.price * l.qty)}</b>
              <button type="button" class="mini mini--danger" data-cart-remove="${esc(key)}" aria-label="Remove">×</button>
            </div>`;
        }).join("")
      : '<div class="empty"><b>No pieces yet</b>Tap a size on the left to add it.</div>';

    $("#payMethods").innerHTML = PAY.map((m) =>
      `<button type="button" class="${payMethod === m[0] ? "is-active" : ""}" data-pay="${m[0]}">${m[1]}</button>`).join("");
    $("#tenderField").hidden = payMethod !== "cash";
    $("#cartDone").disabled = !CART.length;
    renderCartTotal();
  }

  function renderCartTotal() {
    const total = cartTotal();
    const saving = cartSaving();
    const tender = Number($("#cartTender").value);
    const change = payMethod === "cash" && tender > 0 ? tender - total : null;
    $("#cartTotal").innerHTML =
      `<span>Total</span><b>${money(total)}</b>` +
      (saving ? `<small>Customer saves ${money(saving)}</small>` : "") +
      (change !== null ? (change >= 0
        ? `<small class="is-good">Change to give: <b>${money(change)}</b></small>`
        : `<small class="is-bad">Short by ${money(-change)}</small>`) : "");
  }

  function clearCart() {
    CART = [];
    ["#cartTender", "#cartName", "#cartPhone", "#cartNote"].forEach((sel) => { $(sel).value = ""; });
    $("#cartMsg").textContent = "";
    renderCart();
  }

  async function completeSale() {
    if (!CART.length) return;
    const total = cartTotal();
    const tender = Number($("#cartTender").value);
    if (payMethod === "cash" && tender > 0 && tender < total) {
      note("#cartMsg", "The cash received is less than the total.", false);
      return;
    }
    const btn = $("#cartDone");
    btn.disabled = true;
    note("#cartMsg", "Recording the sale…", true);
    const items = CART.map((l) => {
      const it = { id: l.id, size: l.size, qty: l.qty };
      if (l.price !== l.list) it.unit_price = l.price;
      return it;
    });
    const { data, error } = await sb.rpc("record_pos_sale", {
      p_items: items,
      p_payment: payMethod,
      p_customer_name: $("#cartName").value.trim() || null,
      p_customer_phone: $("#cartPhone").value.trim() || null,
      p_note: $("#cartNote").value.trim() || null
    });
    btn.disabled = false;
    if (error) {
      const hint = /function|schema cache/i.test(error.message) ? " Run docs/supabase-counter-manager.sql first." : "";
      note("#cartMsg", error.message + hint, false);
      return;
    }
    const code = data && data.code ? data.code : "";
    const change = payMethod === "cash" && tender > 0 ? tender - total : null;
    const box = $("#receipt");
    box.hidden = false;
    box.innerHTML = `
      <div class="receipt">
        <div><b>Sale ${esc(code)} recorded</b>
          <p class="hint">${money(total)} · paid by ${esc((PAY.find((m) => m[0] === payMethod) || [0, payMethod])[1])}${change !== null ? " · change " + money(change) : ""}</p></div>
        <button class="mini" type="button" id="receiptClose">Done</button>
      </div>`;
    clearCart();
    flash("Sale recorded");
    await loadData();
  }

  /* =========================================================================
     TILL SALES (history)
     ========================================================================= */

  function renderSales() {
    const live = POS.filter((s) => !s.voided_at);
    const todays = sinceDays(live, 1);
    const by = (m) => sum(todays.filter((s) => s.payment === m), (s) => s.subtotal);
    $("#salesKpis").innerHTML =
      kpi("Till today", money(sum(todays, (s) => s.subtotal)), todays.length + (todays.length === 1 ? " sale" : " sales")) +
      kpi("Cash", money(by("cash")), "to count in the drawer") +
      kpi("M-Pesa", money(by("mpesa")), "check against your phone") +
      kpi("Card and other", money(by("card") + by("other")), "today");

    const q = ui.salesQuery.trim().toLowerCase();
    const shown = POS.filter((s) => !q ||
      ((s.code || "") + " " + (s.customer_name || "") + " " + (s.cashier_email || "")).toLowerCase().indexOf(q) !== -1).slice(0, 150);

    $("#salesList").innerHTML = shown.length
      ? shown.map((s) => `
          <article class="order${s.voided_at ? " is-cancelled" : " is-verified"}">
            <div class="order__head">
              <div class="order__tags">
                <span class="order__code">${esc(s.code)}</span>
                <span class="pill">${esc((PAY.find((m) => m[0] === s.payment) || [0, s.payment])[1])}</span>
                ${s.voided_at ? '<span class="pill pill--wait">Voided</span>' : ""}
              </div>
              <span class="order__when">${when(s.created_at)}</span>
            </div>
            <p class="order__who"><b>${esc(s.customer_name || "Walk-in")}</b> <span>${s.customer_phone ? "· " + esc(s.customer_phone) + " " : ""}· sold by ${esc(s.cashier_email || "")}</span></p>
            <ul class="order__items">
              ${itemsOf(s).map((i) => `
                <li><span>${esc(i.qty)} × ${esc(i.name)}${i.size ? " (" + esc(i.size) + ")" : ""}</span>
                <span>${money(Number(i.price) * Number(i.qty))}</span></li>`).join("")}
            </ul>
            <div class="order__money">
              <span>Total <b>${money(s.subtotal)}</b></span>
              ${Number(s.discount_total) ? `<span>Customer saved <b>${money(s.discount_total)}</b></span>` : ""}
            </div>
            ${s.note ? `<p class="order__note">Note: ${esc(s.note)}</p>` : ""}
            ${s.voided_at ? `<p class="order__note">Voided by ${esc(s.voided_by || "")} · ${when(s.voided_at)} · ${esc(s.void_reason || "")}</p>` : ""}
            ${IS_MANAGER && !s.voided_at ? `<div class="order__acts"><button class="mini mini--danger" type="button" data-void="${esc(s.id)}">Void sale</button></div>` : ""}
          </article>`).join("")
      : '<div class="empty"><b>No till sales yet</b>Sales you complete on the Sell tab appear here.</div>';
  }

  async function voidSale(id) {
    const row = POS.find((s) => String(s.id) === String(id));
    const reason = window.prompt("Void " + (row ? row.code : "this sale") + "? The pieces go back into stock.\n\nWhy is it being voided?");
    if (reason === null) return;
    if (reason.trim().length < 3) { flash("Give a short reason.", true); return; }
    await stockRpc("void_pos_sale", { p_sale: id, p_reason: reason.trim() }, "Sale voided. Stock put back.");
  }

  /* --- wiring for Sell, Stock and Till sales ------------------------------------------ */

  function wireTill() {
    $("#sellSearch").addEventListener("input", (e) => { ui.sellQuery = e.target.value; renderSell(); });
    $("#stockSearch").addEventListener("input", (e) => { ui.stockQuery = e.target.value; renderStock(); });
    $("#salesSearch").addEventListener("input", (e) => { ui.salesQuery = e.target.value; renderSales(); });
    $("#cartTender").addEventListener("input", renderCartTotal);
    $("#cartClear").addEventListener("click", clearCart);
    $("#cartDone").addEventListener("click", completeSale);

    $("#sellTiles").addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add && !add.disabled) addToCart(add.dataset.add, add.dataset.size || "");
    });

    $("#cartLines").addEventListener("click", (e) => {
      const inc = e.target.closest("[data-cart-inc]");
      const dec = e.target.closest("[data-cart-dec]");
      const rm = e.target.closest("[data-cart-remove]");
      if (inc) {
        const l = cartLine(inc.dataset.cartInc);
        if (l) addToCart(l.id, l.size);
      } else if (dec) {
        const l = cartLine(dec.dataset.cartDec);
        if (l) { l.qty -= 1; if (l.qty < 1) CART = CART.filter((x) => x !== l); renderCart(); }
      } else if (rm) {
        const l = cartLine(rm.dataset.cartRemove);
        if (l) { CART = CART.filter((x) => x !== l); renderCart(); }
      }
    });

    /* a negotiated price: never above the shop price, the database checks it too */
    $("#cartLines").addEventListener("change", (e) => {
      const input = e.target.closest("[data-cart-price]");
      if (!input) return;
      const l = cartLine(input.dataset.cartPrice);
      if (!l) return;
      let v = Number(input.value);
      if (!(v >= 0)) v = l.price;
      if (v > l.list) { v = l.list; flash("The price cannot be above " + money(l.list) + ".", true); }
      l.price = v;
      renderCart();
    });

    $("#payMethods").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pay]");
      if (b) { payMethod = b.dataset.pay; renderCart(); }
    });

    $("#receipt").addEventListener("click", (e) => {
      if (e.target.closest("#receiptClose")) $("#receipt").hidden = true;
    });

    $("#stockFilter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-stockfilter]");
      if (b) { ui.stockFilter = b.dataset.stockfilter; renderStock(); }
    });

    $("#stockList").addEventListener("click", (e) => {
      const act = e.target.closest("[data-stock-act]");
      if (act) { stockAction(act.closest(".stockrow"), act.dataset.stockAct); return; }
      const start = e.target.closest("[data-startcount]");
      if (start) startCount(start.dataset.startcount);
    });

    $("#salesList").addEventListener("click", (e) => {
      const v = e.target.closest("[data-void]");
      if (v) voidSale(v.dataset.void);
    });
  }

  /* --- render + wiring ---------------------------------------------------------------- */

  function updateBadges() {
    const n = waitingOrders().length;
    $$('[data-pane="orders"] .count').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
    const st = stockSummary();
    const attention = st.low + st.out;
    $$('[data-pane="stock"] .count').forEach((el) => {
      el.textContent = attention;
      el.hidden = attention === 0;
    });
  }

  function renderAll() {
    updateBadges();
    renderOverview();
    renderSell();
    renderProducts();
    renderOrders();
    renderStock();
    renderSales();
    renderStats();
  }

  function fillSelects() {
    $("#pDepartment").innerHTML = DEPTS.map((d) => `<option value="${d.slug}">${esc(d.name)}</option>`).join("");
    fillTypes();
    $("#orderStatus").innerHTML = ['<option value="all">Any status</option>']
      .concat(STATUSES.map((s) => `<option value="${s}">${s}</option>`)).join("");
  }

  function wirePasswordToggle() {
    const toggle = $("#pwToggle");
    const input = $("#password");
    toggle.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      toggle.setAttribute("aria-pressed", String(!showing));
    });
  }

  let mounted = false;

  /* The dashboard is not part of the page. Its markup is loaded from
     js/desk.js and added only after someone has signed in, so a visitor
     who is not signed in sees nothing but the sign in form. */
  function mountDesk() {
    if (mounted) return;
    mounted = true;
    document.body.insertAdjacentHTML("beforeend", window.MC_DESK_HTML || "");
    fillSelects();
    buildNav();
    /* the theme buttons did not exist when theme.js labelled them */
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    $$("[data-theme-toggle]").forEach((b) => {
      b.textContent = dark ? "\u2600 Light" : "\uD83C\uDF19 Dark";
      b.setAttribute("aria-pressed", String(dark));
    });
    $("#signOut").addEventListener("click", signOut);
    $("#signOutMobile").addEventListener("click", signOut);
    $("#refreshAll").addEventListener("click", async () => { await loadData(); flash("Up to date"); });

    document.addEventListener("click", (event) => {
      const nav = event.target.closest("#sideNav [data-pane], #tabbar [data-pane]");
      if (nav) { setPane(nav.dataset.pane); return; }
      const go = event.target.closest("[data-goto]");
      if (go) { setPane(go.dataset.goto); return; }
      const ap = event.target.closest("[data-approve]");
      if (ap) {
        const pick = $('[data-approve-role="' + ap.dataset.approve + '"]');
        approveStaff(ap.dataset.approve, pick ? pick.value : "counter");
        return;
      }
      const mk = event.target.closest("[data-make-manager]");
      if (mk) { approveStaff(mk.dataset.makeManager, "manager"); return; }
      const rm = event.target.closest("[data-remove-staff]");
      if (rm) { removeStaff(rm.dataset.removeStaff); return; }
      const rs = event.target.closest("[data-reset-staff]");
      if (rs) { resetStaff(rs.dataset.resetStaff); return; }
      const delOrder = event.target.closest("[data-delete-order]");
      if (delOrder) { deleteOrder(delOrder.dataset.deleteOrder); return; }
      const verify = event.target.closest("[data-verify]");
      if (verify) { setVerified(verify.dataset.verify, true); return; }
      const undo = event.target.closest("[data-unverify]");
      if (undo) { setVerified(undo.dataset.unverify, false); return; }
      const vs = event.target.closest("[data-verif]");
      if (vs) { ui.verif = vs.dataset.verif; renderOrders(); return; }
      const per = event.target.closest("[data-period]");
      if (per) { ui.period = Number(per.dataset.period); renderStats(); }
    });

    $("#orderSearch").addEventListener("input", (event) => { ui.orderQuery = event.target.value; renderOrders(); });
    $("#orderStatus").addEventListener("change", (event) => { ui.status = event.target.value; renderOrders(); });
    $("#prodSearch").addEventListener("input", (event) => { ui.prodQuery = event.target.value; renderProducts(); });

    $("#orderList").addEventListener("change", (event) => {
      const picker = event.target.closest("[data-status]");
      if (picker) patchOrder(picker.dataset.status, { status: picker.value }, "Order moved to " + picker.value);
    });

    $("#addProduct").addEventListener("click", () => openSheet(null));
    $("#sheetClose").addEventListener("click", closeSheet);
    $("#cancelEdit").addEventListener("click", closeSheet);
    $("#sheetScrim").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });
    $("#productForm").addEventListener("submit", saveProduct);
    $("#pDepartment").addEventListener("change", () => fillTypes());
    $("#pPrice").addEventListener("input", previewOffer);
    $("#pCompare").addEventListener("input", previewOffer);
    $("#pImageFile").addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;
      $("#pImagePreview").src = URL.createObjectURL(file);
      $("#pImagePreviewWrap").hidden = false;
    });

    $("#productList").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit]");
      if (edit) {
        const row = PRODUCTS.find((p) => String(p.id) === edit.dataset.edit);
        if (row) openSheet(row);
        return;
      }
      const toggle = event.target.closest("[data-toggle]");
      if (toggle) { toggleProduct(toggle.dataset.toggle, toggle.dataset.active === "true"); return; }
      const del = event.target.closest("[data-delete]");
      if (del) { deleteProduct(del.dataset.delete); return; }
      const jump = event.target.closest("[data-stockjump]");
      if (jump) {
        const row = PRODUCTS.find((p) => String(p.id) === jump.dataset.stockjump);
        if (row) {
          ui.stockQuery = row.name;
          ui.stockFilter = "all";
          $("#stockSearch").value = row.name;
          renderStock();
          setPane("stock");
        }
      }
    });
    wireTill();
  }

  async function boot() {
    wirePasswordToggle();

    $("#gateForm").addEventListener("submit", signIn);
    $("#forgotBtn").addEventListener("click", forgotPassword);
    $("#resetForm").addEventListener("submit", saveNewPassword);

    if (!sb) {
      showGate("Supabase is not configured yet. Add your project URL and anon key to js/config.js.");
      return;
    }
    if (recovering) { showReset(); return; }

    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      await enter(data.session.user);
    } else {
      showGate("");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
