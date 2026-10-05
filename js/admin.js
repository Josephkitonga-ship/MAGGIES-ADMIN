/* ===========================================================
   MAGGIE'S COLLECTION — admin/admin.js
   One script, three desks. The page says which one it is with
   <body data-store="maggies | davids | owner">:

     maggies / davids   that boutique's products, orders, sales
     owner              both boutiques, side by side

   Who may see what is decided by the database (row level
   security in docs/supabase-two-stores.sql). This file only
   decides what to show; it cannot widen access.

   Numbers: a "sale" is an order that has been VERIFIED and not
   cancelled. Sales are the item subtotal (delivery fees are not
   sales). Discount given = (marked price - selling price) x qty,
   stamped on the order when it was placed.
   =========================================================== */

(function () {
  "use strict";

  const SHOP = window.SHOP;
  const STORES = SHOP.stores;
  const ORD = window.MC_ORDERS;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const MODE = document.body.dataset.store || "";
  const IS_OWNER = MODE === "owner";
  const STORE_MODE = IS_OWNER ? null : MODE;
  /* The owner desk is view only: sales, discounts and comparisons.
     Adding products, verifying orders and changing statuses belong to
     the store admins. The database enforces this too
     (docs/supabase-owner-readonly.sql); hiding the buttons is just manners. */
  const CAN_EDIT = !IS_OWNER;

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
    { id: "products", label: "Products", title: "Products", icon: svg('<path d="M3.5 12.5v-8h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2"/>') },
    { id: "orders", label: "Orders", title: "Orders", icon: svg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>') },
    { id: "stats", label: "Stats", title: "Sales and discounts", icon: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>') }
  ];

  const PANES = PANES_BASE.concat(IS_OWNER ? [
    { id: "staff", label: "Staff", title: "Staff access", icon: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 11v6M14 14h6"/>') }
  ] : []);

  /* --- state ------------------------------------------------------ */

  let me = null;               // { email, role, store }
  let PRODUCTS = [];
  let ORDERS = [];
  let STAFF = [];   // everyone with a login, from list_staff_accounts() (owner only)
  let editingId = null;
  let editingImageUrl = "";
  let editingGallery = [];

  const ui = {
    pane: "overview",
    scope: STORE_MODE || "all",   // owner can switch: all | maggies | davids
    period: 30,
    verif: "pending",             // pending | verified | all
    status: "all",
    orderQuery: "",
    prodQuery: ""
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

  function storeOf(slug) {
    return STORES.find((s) => s.slug === slug) || STORES[0];
  }

  function badge(slug) {
    const s = storeOf(slug);
    return '<span class="badge badge--' + esc(s.slug) + '">' + esc(s.short) + "</span>";
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
    shoes: "EU numbers, for example 36, 37, 38 \u2026 45.",
    bags: "Small, Medium, Large, or Suitcase for travel cases.",
    accessories: "One size, unless it comes in sizes."
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

  function scoped(rows) {
    return ui.scope === "all" ? rows : rows.filter((r) => r.store === ui.scope);
  }

  const isSale = (o) => !!o.verified_at && o.status !== "cancelled";
  const isWaiting = (o) => !o.verified_at && o.status !== "cancelled";
  const itemsOf = (o) => (Array.isArray(o.items) ? o.items : []);
  const unitsOf = (o) => sum(itemsOf(o), (i) => i.qty);

  function summarise(orders) {
    const sold = orders.filter(isSale);
    const wait = orders.filter(isWaiting);
    const sales = sum(sold, (o) => o.subtotal);
    return {
      sales: sales,
      orders: sold.length,
      units: sum(sold, unitsOf),
      discount: sum(sold, (o) => o.discount_total),
      aov: sold.length ? Math.round(sales / sold.length) : 0,
      waitCount: wait.length,
      waitValue: sum(wait, (o) => o.subtotal)
    };
  }

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
      .from("staff").select("role, store").eq("user_id", user.id).maybeSingle();

    if (error || !staff) {
      await sb.auth.signOut();
      showGate("Your access is waiting for approval. Ask the owner to approve you, then sign in again.");
      return;
    }
    /* Each sign in opens one desk only:
         owner.html        owner accounts
         maggie / david    that store's own admin accounts
       An owner account is not let into a store desk. */
    const allowed = IS_OWNER
      ? staff.role === "owner"
      : (staff.role === "store_admin" && staff.store === MODE);
    if (!allowed) {
      await sb.auth.signOut();
      const own = staff.role === "owner" ? "the owner desk" : storeOf(staff.store).name + "'s desk";
      showGate("This sign in belongs to " + own + ". Go back to the staff sign in page and choose your own desk.");
      return;
    }

    me = { email: user.email, role: staff.role, store: staff.store };
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
    $("#who").textContent = me.email + (me.role === "owner" ? " · owner" : "");
    const label = IS_OWNER ? "Owner desk" : storeOf(MODE).name;
    $("#deskName").textContent = label;
    $("#deskKind").textContent = IS_OWNER ? "Both boutiques · view only" : "Store desk";
    $("#topStore").textContent = label + (IS_OWNER ? " · view only" : "");
    $("#addProduct").hidden = !CAN_EDIT;
    $$("[data-owner-only]").forEach((el) => { el.hidden = !IS_OWNER; });
    setPane(ui.pane);
    loadData();
  }

  /* --- data --------------------------------------------------------- */

  async function loadData() {
    if (!sb) return;
    let pq = sb.from("products").select("*").order("sort", { ascending: true });
    /* max 1000 recent orders; RLS already limits store admins to their own */
    let oq = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(1000);
    if (STORE_MODE) { pq = pq.eq("store", STORE_MODE); oq = oq.eq("store", STORE_MODE); }

    const [p, o] = await Promise.all([pq, oq]);
    const failed = p.error || o.error;
    if (failed) {
      const hint = /store|column/i.test(failed.message)
        ? " Run docs/supabase-two-stores.sql in the Supabase SQL editor first."
        : "";
      note("#deskMsg", "Could not load the desk: " + failed.message + "." + hint, false);
      return;
    }
    $("#deskMsg").textContent = "";
    if (IS_OWNER) loadStaff();
    PRODUCTS = (p.data || []).map((x) => Object.assign({}, x, { store: x.store || STORES[0].slug }));
    ORDERS = (o.data || []).map((x) => Object.assign({}, x, { store: x.store || STORES[0].slug }));
    renderAll();
  }

  /* --- navigation ----------------------------------------------------- */

  function buildNav() {
    const item = (cls) => PANES.map((p) =>
      `<button type="button" class="${cls}" data-pane="${p.id}">${p.icon}<span>${p.label}</span>${p.id === "orders" || p.id === "staff" ? '<i class="count" hidden></i>' : ""}</button>`
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
      return '<div class="empty"><b>No verified sales in this period yet</b>Verify an order and it shows up here.</div>';
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

  /* One series normally; two (Maggie's, David's) when the owner is looking at both. */
  function salesChart(orders, days) {
    const both = IS_OWNER && ui.scope === "all";
    const keys = both ? STORES.map((s) => s.slug) : [null];
    const today = startOfDay(new Date());
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      list.push({ date: d, key: dayKey(d), values: keys.map(() => 0) });
    }
    const at = new Map(list.map((x, i) => [x.key, i]));
    orders.filter(isSale).forEach((o) => {
      const i = at.get(dayKey(new Date(o.created_at)));
      if (i === undefined) return;
      const s = both ? keys.indexOf(o.store) : 0;
      if (s >= 0) list[i].values[s] += Number(o.subtotal) || 0;
    });
    const legend = both
      ? '<div class="legend">' + STORES.map((s, i) => '<span><i style="background:var(--s' + (i + 1) + ')"></i>' + esc(s.name) + "</span>").join("") + "</div>"
      : "";
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

  function renderOverview() {
    const orders = scoped(ORDERS);
    const products = scoped(PRODUCTS);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const today = summarise(sinceDays(orders, 1));
    const month = summarise(orders.filter((o) => new Date(o.created_at) >= monthStart));
    const all = summarise(orders);
    const live = products.filter((p) => p.active).length;

    $("#ovKpis").innerHTML =
      kpi("Sales today", money(today.sales), today.orders + (today.orders === 1 ? " verified order" : " verified orders")) +
      kpi("Sales this month", money(month.sales), month.discount ? money(month.discount) + " in discounts" : month.orders + " verified orders") +
      kpi("Waiting for verification", String(all.waitCount), all.waitCount ? money(all.waitValue) + " to confirm" : "All caught up", all.waitCount > 0) +
      kpi("On the rail", String(live), (products.length - live) + " hidden");

    const cards = $("#ovStores");
    cards.hidden = !(IS_OWNER && ui.scope === "all");
    if (!cards.hidden) {
      cards.innerHTML = STORES.map((s) => {
        const mine = ORDERS.filter((o) => o.store === s.slug);
        const m = summarise(mine.filter((o) => new Date(o.created_at) >= monthStart));
        const w = summarise(mine);
        const n = PRODUCTS.filter((p) => p.store === s.slug && p.active).length;
        return `
          <article class="storecard storecard--${esc(s.slug)}">
            <div class="storecard__top"><b>${esc(s.name)}</b></div>
            <dl>
              <div><dt>Sales this month</dt><dd>${money(m.sales)}</dd></div>
              <div><dt>Verified orders this month</dt><dd>${m.orders}</dd></div>
              <div><dt>Discounts given this month</dt><dd>${money(m.discount)}</dd></div>
              <div><dt>Waiting for verification</dt><dd>${w.waitCount}${w.waitCount ? " · " + money(w.waitValue) : ""}</dd></div>
              <div><dt>Pieces on the rail</dt><dd>${n}</dd></div>
            </dl>
          </article>`;
      }).join("");
    }

    $("#ovChart").innerHTML = salesChart(sinceDays(orders, 14), 14);

    const waiting = orders.filter(isWaiting).slice(0, 6);
    $("#ovPending").innerHTML = waiting.length
      ? waiting.map((o) => `
          <div class="row" style="grid-template-columns:1fr auto">
            <div>
              <div class="row__title">${esc(o.code || o.id)} ${IS_OWNER ? badge(o.store) : ""}</div>
              <div class="row__meta">${esc(o.customer_name)} · ${money(o.subtotal)} · ${when(o.created_at)}</div>
            </div>
            <div class="row__acts" style="grid-column:auto">
              ${CAN_EDIT
                ? `<button class="mini mini--go" type="button" data-verify="${esc(o.id)}">Verify</button>`
                : '<span class="pill pill--wait">Awaiting verification</span>'}
            </div>
          </div>`).join("")
      : '<div class="empty"><b>Nothing waiting</b>New orders that need verifying will appear here.</div>';
  }

  /* --- products --------------------------------------------------------------- */

  function renderProducts() {
    const q = ui.prodQuery.trim().toLowerCase();
    const rows = scoped(PRODUCTS).filter((p) =>
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
            <div class="row__title">${esc(p.name)} ${IS_OWNER ? badge(p.store) : ""}${pct ? `<span class="badge badge--off">−${pct}%</span>` : ""}</div>
            <div class="row__meta">
              <span class="row__price">${money(p.price)}${pct ? `<s>${money(p.compare_price)}</s>` : ""}</span> ·
              ${esc(placeLabel(p))} ·
              ${Array.isArray(p.sizes) && p.sizes.length ? esc(p.sizes.join(", ")) : "no sizes"} ·
              <span class="pill${p.active ? " pill--new" : ""}">${p.active ? "on the rail" : "hidden"}</span>
            </div>
          </div>
          ${CAN_EDIT ? `<div class="row__acts">
            <button class="mini" type="button" data-edit="${esc(p.id)}">Edit</button>
            <button class="mini${p.active ? " mini--on" : ""}" type="button" data-toggle="${esc(p.id)}" data-active="${p.active}">${p.active ? "Hide" : "Show"}</button>
            <button class="mini mini--danger" type="button" data-delete="${esc(p.id)}">Delete</button>
          </div>` : ""}
        </div>`;
    }).join("");
  }

  function openSheet(product) {
    if (!CAN_EDIT) return;
    editingId = product ? product.id : null;
    editingImageUrl = product ? (product.image_url || "") : "";
    editingGallery = product && Array.isArray(product.gallery) ? product.gallery.slice() : [];
    $("#sheetTitle").textContent = product ? "Edit product" : "Add a product";
    $("#sheetMsg").textContent = "";

    $("#pStore").value = product ? product.store : (STORE_MODE || (ui.scope !== "all" ? ui.scope : STORES[0].slug));
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
    if (!CAN_EDIT) return;
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
      store: IS_OWNER ? $("#pStore").value : STORE_MODE,
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

    const result = editingId
      ? await sb.from("products").update(payload).eq("id", editingId)
      : await sb.from("products").insert(payload);

    if (result.error) { note("#sheetMsg", "Save failed: " + result.error.message, false); return; }
    closeSheet();
    flash(editingId ? "Changes saved" : name + " is on the rail");
    loadData();
  }

  async function toggleProduct(id, isActive) {
    if (!CAN_EDIT) return;
    const { error } = await sb.from("products").update({ active: !isActive }).eq("id", id);
    if (error) { flash("Could not change that: " + error.message, true); return; }
    flash(isActive ? "Hidden from the rail" : "Back on the rail");
    loadData();
  }

  async function deleteProduct(id) {
    if (!CAN_EDIT) return;
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
      encodeURIComponent("Hi " + o.customer_name + ", this is " + storeOf(o.store).name + " about your order " + (o.code || "") + ".");

    return `
      <article class="order${cls}">
        <div class="order__head">
          <div class="order__tags">
            <span class="order__code">${esc(o.code || o.id)}</span>
            ${badge(o.store)}
            <span class="pill${o.status === "new" ? " pill--new" : ""}${o.status === "delivered" ? " pill--done" : ""}">${esc(o.status)}</span>
            ${o.group_code ? '<span class="pill" title="The customer also asked about pieces from the other store in the same message">Mixed selection</span>' : ""}
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
          ${CAN_EDIT ? (verified
            ? `<span class="order__stamp">Verified${o.verified_by ? " by " + esc(o.verified_by) : ""} · ${when(o.verified_at)}</span>
               <button class="mini" type="button" data-unverify="${esc(o.id)}">Undo</button>`
            : `<button class="mini mini--go" type="button" data-verify="${esc(o.id)}">Verify order</button>`)
          : (verified
            ? `<span class="order__stamp">Verified${o.verified_by ? " by " + esc(o.verified_by) : ""} · ${when(o.verified_at)}</span>`
            : '<span class="pill pill--wait">Awaiting verification</span>')}
          ${CAN_EDIT ? `<select class="mini" data-status="${esc(o.id)}" aria-label="Order status">
            ${STATUSES.map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${s}</option>`).join("")}
          </select>` : ""}
          ${CAN_EDIT && o.status === "cancelled" ? `<button class="mini mini--danger" type="button" data-delete-order="${esc(o.id)}">Delete</button>` : ""}
          ${CAN_EDIT && ORD.waPhone(o.customer_phone).length >= 11 ? `<a class="mini" href="${esc(wa)}" target="_blank" rel="noopener">Message customer</a>` : ""}
        </div>
      </article>`;
  }

  function renderOrders() {
    const all = scoped(ORDERS);
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
    if (!CAN_EDIT) return false;
    const { error } = await sb.from("orders").update(patch).eq("id", id);
    if (error) { flash("Could not update: " + error.message, true); return false; }
    const row = ORDERS.find((o) => String(o.id) === String(id));
    if (row) Object.assign(row, patch);
    renderAll();
    flash(message);
    return true;
  }

  /* Only cancelled orders can be deleted (the database enforces this too),
     so a real sale can never be wiped by a mis-tap. To remove a test order,
     set it to "cancelled" first. */
  async function deleteOrder(id) {
    if (!CAN_EDIT) return;
    const row = ORDERS.find((o) => String(o.id) === String(id));
    if (!row || row.status !== "cancelled") { flash("Set the order to cancelled first.", true); return; }
    if (!window.confirm("Delete order " + (row.code || "") + " for good? This cannot be undone.")) return;
    const { error } = await sb.from("orders").delete().eq("id", id);
    if (error) { flash("Could not delete: " + error.message, true); return; }
    ORDERS = ORDERS.filter((o) => String(o.id) !== String(id));
    renderAll();
    flash("Order deleted");
  }

  function setVerified(id, on) {
    return patchOrder(id,
      on ? { verified_at: new Date().toISOString(), verified_by: me.email } : { verified_at: null, verified_by: null },
      on ? "Order verified" : "Verification removed");
  }

  /* --- stats --------------------------------------------------------------------- */

  function renderStats() {
    const orders = sinceDays(scoped(ORDERS), ui.period);
    const sm = summarise(orders);

    $("#periodSwitch").innerHTML = [7, 30, 90].map((d) =>
      `<button type="button" class="${ui.period === d ? "is-active" : ""}" data-period="${d}">Last ${d} days</button>`).join("");

    $("#stKpis").innerHTML =
      kpi("Verified sales", money(sm.sales), sm.units + (sm.units === 1 ? " piece sold" : " pieces sold")) +
      kpi("Verified orders", String(sm.orders), sm.waitCount + " still waiting") +
      kpi("Average order", money(sm.aov), "items only, no delivery") +
      kpi("Discounts given", money(sm.discount), sm.sales + sm.discount ? Math.round((sm.discount / (sm.sales + sm.discount)) * 100) + "% of marked value" : "none yet");

    $("#stChart").innerHTML = salesChart(orders, ui.period);

    const compare = $("#stCompareWrap");
    compare.hidden = !(IS_OWNER && ui.scope === "all");
    if (!compare.hidden) {
      const per = STORES.map((s) => summarise(orders.filter((o) => o.store === s.slug)));
      const rate = (x) => (x.sales + x.discount ? Math.round((x.discount / (x.sales + x.discount)) * 100) + "%" : "0%");
      const live = (slug) => PRODUCTS.filter((p) => p.store === slug && p.active).length;
      const lines = [
        ["Verified sales", (x) => money(x.sales)],
        ["Verified orders", (x) => x.orders],
        ["Pieces sold", (x) => x.units],
        ["Average order", (x) => money(x.aov)],
        ["Discounts given", (x) => money(x.discount)],
        ["Discount as share of marked value", rate],
        ["Waiting for verification", (x) => x.waitCount + (x.waitCount ? " · " + money(x.waitValue) : "")]
      ];
      const total = per[0].sales + per[1].sales;
      const pct0 = total ? Math.round((per[0].sales / total) * 100) : 0;
      $("#stCompare").innerHTML = `
        <table class="compare">
          <thead><tr><th></th>${STORES.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th>Combined</th></tr></thead>
          <tbody>
            ${lines.map((l) => `<tr><td>${l[0]}</td>${per.map((x) => `<td>${l[1](x)}</td>`).join("")}<td>${l[1](sm)}</td></tr>`).join("")}
            <tr><td>Pieces on the rail</td>${STORES.map((s) => `<td>${live(s.slug)}</td>`).join("")}<td>${live(STORES[0].slug) + live(STORES[1].slug)}</td></tr>
          </tbody>
        </table>
        <div class="share" role="img" aria-label="Share of sales"><span style="width:${pct0}%"></span><span style="width:${total ? 100 - pct0 : 0}%"></span></div>
        <div class="legend"><span><i style="background:var(--s1)"></i>${esc(STORES[0].short)} ${total ? pct0 : 0}%</span><span><i style="background:var(--s2)"></i>${esc(STORES[1].short)} ${total ? 100 - pct0 : 0}%</span></div>`;
    }

    /* best sellers */
    const sold = orders.filter(isSale);
    const byProduct = new Map();
    sold.forEach((o) => itemsOf(o).forEach((i) => {
      const key = (i.id || i.name) + "|" + o.store;
      const row = byProduct.get(key) || { name: i.name, store: o.store, qty: 0, revenue: 0 };
      row.qty += Number(i.qty) || 0;
      row.revenue += (Number(i.price) || 0) * (Number(i.qty) || 0);
      byProduct.set(key, row);
    }));
    const showStore = IS_OWNER && ui.scope === "all";
    $("#stTop").innerHTML = hbars(
      Array.from(byProduct.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6).map((r) => ({
        label: r.name + (showStore ? " · " + storeOf(r.store).short : ""),
        value: r.revenue,
        sub: r.qty + " sold · " + money(r.revenue),
        cls: showStore ? r.store : ""
      })));

    /* departments */
    const deptOf = new Map(PRODUCTS.map((p) => [String(p.id), ORD.placeProduct(p, DEPTS).department]));
    const byCat = new Map();
    sold.forEach((o) => itemsOf(o).forEach((i) => {
      const name = deptName(deptOf.get(String(i.id)) || "");
      byCat.set(name, (byCat.get(name) || 0) + (Number(i.price) || 0) * (Number(i.qty) || 0));
    }));
    $("#stCats").innerHTML = hbars(
      Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).map((e) => ({ label: e[0], value: e[1], sub: money(e[1]) })));
  }

  /* --- staff access (owner desk only) -------------------------------------------------- */

  async function loadStaff() {
    if (!IS_OWNER || !sb) return;
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

  const storeOptions = (selected) => STORES.map((s) =>
    `<option value="${esc(s.slug)}"${s.slug === selected ? " selected" : ""}>${esc(s.name)}</option>`).join("");

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
          <select class="mini" data-store-for="${esc(a.account_id)}" aria-label="Desk for ${esc(a.account_email)}">${storeOptions(STORES[0].slug)}</select>
          <button class="mini mini--go" type="button" data-approve="${esc(a.account_id)}"${ok ? "" : " disabled"}>Approve</button>
        </div>
      </div>`;
  }

  function activeRow(a) {
    const mine = me && a.account_email === me.email;
    const owner = a.staff_role === "owner";
    return `
      <div class="row" style="grid-template-columns:1fr">
        <div>
          <div class="row__title">${esc(a.account_email)}${mine ? ' <span class="pill">You</span>' : ""}
            ${owner ? '<span class="pill pill--new">Owner</span>' : badge(a.staff_store)}
          </div>
          <div class="row__meta">${owner ? "Owner · both boutiques, view only" : "Store admin · " + esc(storeOf(a.staff_store).name)} · ${a.last_sign_in ? "last sign in " + when(a.last_sign_in) : "has not signed in yet"}</div>
        </div>
        ${owner ? "" : `
        <div class="row__acts" style="grid-column:auto">
          <select class="mini" data-store-for="${esc(a.account_id)}" aria-label="Desk for ${esc(a.account_email)}">${storeOptions(a.staff_store)}</select>
          <button class="mini" type="button" data-approve="${esc(a.account_id)}">Move</button>
          <button class="mini" type="button" data-reset-staff="${esc(a.account_id)}">Send reset link</button>
          <button class="mini mini--danger" type="button" data-remove-staff="${esc(a.account_id)}">Remove access</button>
        </div>`}
      </div>`;
  }

  function renderStaff() {
    if (!IS_OWNER) return;
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

  async function approveStaff(id) {
    const pick = document.querySelector('[data-store-for="' + id + '"]');
    const store = pick ? pick.value : STORES[0].slug;
    const who = staffRow(id);
    const { error } = await sb.rpc("assign_staff", { p_user: id, p_store: store });
    if (error) { flash(error.message, true); return; }
    flash((who ? who.account_email : "Done") + " is now on " + storeOf(store).name);
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
    const desk = { maggies: "maggie.html", davids: "david.html" }[who.staff_store] || "index.html";
    const { error } = await sb.auth.resetPasswordForEmail(who.account_email, {
      redirectTo: location.origin + location.pathname.replace(/[^/]*$/, desk)
    });
    if (error) { flash(/rate|limit|seconds/i.test(error.message) ? "Too many emails just now. Try again in a few minutes." : error.message, true); return; }
    flash("Reset link sent to " + who.account_email);
  }

  /* --- render + wiring ---------------------------------------------------------------- */

  function updateBadges() {
    const n = scoped(ORDERS).filter(isWaiting).length;
    $$('[data-pane="orders"] .count').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  function renderAll() {
    updateBadges();
    renderOverview();
    renderProducts();
    renderOrders();
    renderStats();
  }

  function fillSelects() {
    $("#pDepartment").innerHTML = DEPTS.map((d) => `<option value="${d.slug}">${esc(d.name)}</option>`).join("");
    fillTypes();
    $("#pStore").innerHTML = STORES.map((s) => `<option value="${s.slug}">${esc(s.name)}</option>`).join("");
    $("#orderStatus").innerHTML = ['<option value="all">Any status</option>']
      .concat(STATUSES.map((s) => `<option value="${s}">${s}</option>`)).join("");
    $("#scopeSelect").innerHTML = ['<option value="all">Both boutiques</option>']
      .concat(STORES.map((s) => `<option value="${s.slug}">${esc(s.name)}</option>`)).join("");
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
      if (ap) { approveStaff(ap.dataset.approve); return; }
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

    $("#scopeSelect").addEventListener("change", (event) => { ui.scope = event.target.value; renderAll(); });
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
      if (del) deleteProduct(del.dataset.delete);
    });
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
