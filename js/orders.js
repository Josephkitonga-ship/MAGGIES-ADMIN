/* ===========================================================
   MAGGIE'S COLLECTION — js/orders.js
   Pure order logic shared by the storefront and the staff desks.
   No DOM, no network. Runs in the browser (window.MC_ORDERS)
   and in node (tests/orders.test.js).

     discountPct / saving   marked price vs selling price
     groupByStore           split a cart into one group per boutique
     makeCode               MC-260929-4412 style order codes
     buildMessage           the WhatsApp text (one table, or one per store)
     waPhone                a Kenyan phone number as wa.me digits
   =========================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MC_ORDERS = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

  /* Whole-number percent off. 0 when there is no real discount. */
  function discountPct(price, compare) {
    const p = Number(price);
    const c = Number(compare);
    if (!(c > p) || !(p >= 0)) return 0;
    return Math.round(((c - p) / c) * 100);
  }

  /* KSh saved per item. 0 when there is no real discount. */
  function saving(price, compare) {
    const p = Number(price);
    const c = Number(compare);
    return c > p ? c - p : 0;
  }

  /* lines: [{ store, price, qty, ... }]   stores: SHOP.stores
     Returns [{ store, lines, subtotal }] in store order, only for
     stores that actually have lines. A line with no store belongs
     to the first boutique (carts saved before the two-store update). */
  function groupByStore(lines, stores) {
    const first = stores[0].slug;
    const buckets = new Map();
    lines.forEach(function (line) {
      const slug = line.store || first;
      if (!buckets.has(slug)) buckets.set(slug, []);
      buckets.get(slug).push(line);
    });
    return stores
      .filter(function (s) { return buckets.has(s.slug); })
      .map(function (s) {
        const own = buckets.get(s.slug);
        return {
          store: s,
          lines: own,
          subtotal: own.reduce(function (sum, l) { return sum + Number(l.price) * Number(l.qty); }, 0)
        };
      });
  }

  /* MC-260929-4412. `date` and `rand` are injectable for tests. */
  function makeCode(prefix, date, rand) {
    const d = date || new Date();
    /* the shopper's own calendar day (Kenya time on a Kenyan phone),
       not UTC, so a 1:30 am order is stamped with today's date */
    const two = function (n) { return (n < 10 ? "0" : "") + n; };
    const stamp = String(d.getFullYear()).slice(2) + two(d.getMonth() + 1) + two(d.getDate());
    const tail = Math.floor(1000 + (rand === undefined ? Math.random() : rand) * 9000);
    return prefix + "-" + stamp + "-" + tail;
  }

  function lineText(line, fmt) {
    return "• " + line.qty + " × " + line.name +
      (line.size ? " (" + line.size + ")" : "") +
      " — " + fmt(Number(line.price) * Number(line.qty));
  }

  /* Old category slugs (before departments) and where they now belong.
     Used for old links such as ?c=menswear and for old product rows. */
  const LEGACY = {
    dresses: ["women", "dresses"],
    tops: ["women", "tops"],
    bottoms: ["women", "trousers"],
    menswear: ["men", "tops"],
    kids: ["kids", "tops"],
    ankara: ["women", "african"],
    bags: ["bags", "handbags"],
    shoes: ["shoes", "sandals"],
    accessories: ["accessories", "jewellery"]
  };

  /* Where a product sits: { department, type }.
     A product with a valid department keeps it. An older product with
     no department is placed from its old category. */
  function placeProduct(product, departments) {
    const dep = departments.find(function (d) { return d.slug === product.department; });
    if (dep) return { department: dep.slug, type: product.category };
    const old = LEGACY[product.category];
    if (old) return { department: old[0], type: old[1] };
    return { department: departments[0].slug, type: product.category };
  }

  /* Added in the last `days` days (default 14): the New arrivals filter. */
  function isFresh(product, now, days) {
    const born = product.created_at ? new Date(product.created_at).getTime() : NaN;
    if (isNaN(born)) return false;
    return (now || new Date()).getTime() - born <= (days || 14) * 86400000;
  }

  /* groups: [{ store, code, lines, subtotal }]
     details: { name, phone, location, notes, zone, fee, total }
     fmt: money formatter.
     The text is an enquiry, not a receipt: the shopper is asking the
     shop to check availability and hold the pieces.
     One group  -> one simple list.
     More groups -> one message, a labelled list per group so the shop
     can tell which rail each piece comes from. */
  function buildMessage(groups, details, fmt) {
    const who = [
      "Name: " + details.name,
      "Phone: " + details.phone,
      "Deliver / collect: " + details.location,
      details.notes ? "Notes: " + details.notes : ""
    ].filter(Boolean);

    const items = groups.reduce(function (sum, g) { return sum + g.subtotal; }, 0);
    const delivery = "Delivery (" + details.zone + "): " + (details.fee ? fmt(details.fee) : "free");
    const intro = "Hello! I would like to check availability and reserve these items from my saved list:";

    if (groups.length === 1) {
      const g = groups[0];
      return [
        intro,
        "",
        g.lines.map(function (l) { return lineText(l, fmt); }).join("\n"),
        "",
        "Items: " + fmt(items),
        delivery,
        "Estimated total: " + fmt(details.total),
        "",
        "Ref: " + g.code + " · " + g.store.name,
        ""
      ].concat(who).join("\n");
    }

    const parts = [intro, ""];
    groups.forEach(function (g) {
      parts.push("*" + g.store.name.toUpperCase() + "*");
      parts.push(g.lines.map(function (l) { return lineText(l, fmt); }).join("\n"));
      parts.push("Subtotal: " + fmt(g.subtotal) + " · Ref: " + g.code);
      parts.push("");
    });
    parts.push("Items: " + fmt(items));
    parts.push(delivery);
    parts.push("*Estimated total: " + fmt(details.total) + "*");
    parts.push("");
    return parts.concat(who).join("\n");
  }

  /* One item, asked about straight from its page. */
  function buildItemMessage(product, size, fmt, link) {
    return [
      "Hello! I would like to check availability and reserve this item:",
      "",
      "• " + product.name + (size ? " (" + size + ")" : "") + " — " + fmt(product.price),
      link ? "" : null,
      link || null
    ].filter(function (x) { return x !== null; }).join("\n");
  }

  /* Badges for a product page or card. A staff choice wins:
       highlight "new" | "best_deal" | "none"
     With no choice (null) the shop decides by itself:
       NEW        added in the last 14 days
       BEST DEAL  20% off or more                                     */
  function highlights(product, now) {
    const h = product.highlight;
    if (h === "none") return [];
    if (h === "new") return ["NEW"];
    if (h === "best_deal") return ["BEST DEAL"];
    const out = [];
    const born = product.created_at ? new Date(product.created_at).getTime() : NaN;
    const today = (now || new Date()).getTime();
    if (!isNaN(born) && today - born <= 14 * 86400000) out.push("NEW");
    if (discountPct(product.price, product.compare_price) >= 20) out.push("BEST DEAL");
    return out;
  }

  /* 0712 345 678 / +254 712 345 678 / 712345678  ->  254712345678 */
  function waPhone(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.indexOf("254") === 0) return d;
    if (d.charAt(0) === "0") return "254" + d.slice(1);
    if (d.length === 9 && /^[71]/.test(d)) return "254" + d;
    return d;
  }

  return {
    discountPct: discountPct,
    saving: saving,
    groupByStore: groupByStore,
    makeCode: makeCode,
    buildMessage: buildMessage,
    buildItemMessage: buildItemMessage,
    highlights: highlights,
    LEGACY: LEGACY,
    placeProduct: placeProduct,
    isFresh: isFresh,
    waPhone: waPhone
  };
});
