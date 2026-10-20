# Maggie's Collection — staff desks

Stand-alone admin site at **admin.maggiescollection.co.ke**, kept apart from the shop
(**maggiescollection.co.ke**). Same Supabase project as the shop, so products and orders carry over.

Maggie's is now **one store**. There is one products table, one catalogue and one dashboard.

```
index.html      chooser: Counter or Manager
counter.html    /counter  the shop dashboard
manager.html    /manager  the owner's dashboard
request.html    request access (the manager approves it in the Staff tab)
maggie.html, david.html, owner.html    tiny redirects so old bookmarks still work
css/ js/        styles and scripts
build_admin.py  regenerates the pages and js/desk.js
robots.txt      asks search engines to stay out; pages also carry noindex
```

## What each desk does

| | Counter `/counter` | Manager `/manager` |
|---|---|---|
| Overview (today, this month, low stock, orders waiting) | yes | yes |
| **Sell**: ring up a till sale (cash, M-Pesa, card), change due, negotiated price | yes | yes |
| Website orders: verify, change status, message the customer | yes | yes |
| Products: add, edit, show/hide | yes | yes |
| **Stock**: count, receive, remove, stock take, movement log | yes | yes |
| Till sales history and today's takings by payment type | yes | yes |
| Delete a product for good | no (hide it) | yes |
| Void a till sale (puts the pieces back) | no | yes |
| Reports: website vs till, best sellers, departments, discounts | no | yes |
| **Start fresh**: clear orders, till sales and the stock log (Reports tab) | no | yes |
| Staff: approve as counter or manager, make a counter a manager, send password reset, remove counter access | no | yes |

The manager can also open everything the counter has. A manager who signs in on the counter page is taken to `/manager`.
Counter staff cannot open `/manager`. All of this is enforced by the database, not just by these pages.

## How stock works
- A product is **counted** once you give it opening stock (Stock tab, **Start counting**). Until then it is
  *not counted*: it sells freely and nothing is deducted. Nothing changes for products you have not counted.
- Counted products are tracked **per size**. A size with 0 cannot be sold at the till.
- A **till sale** takes stock out at once. A **website order** takes stock out when you **verify** it.
  If a piece is short, you are asked before it is forced through. **Undo**, or cancelling a verified order, puts the stock back.
- Voiding a till sale (manager) puts the pieces back.
- Every change is written to the movement log (who, when, why). Counts and sales happen inside database
  functions, so the till and the website cannot oversell the same last piece.

## What counts as a sale
A till sale that is not voided, or a website order that has been verified and not cancelled. Delivery fees are not sales.
Discount given = (marked or list price minus price charged) × quantity.

## Staff access (the manager approves)
1. A new person opens `request.html`, enters their email and a password, and confirms the email link.
2. Until approved they can see and change **nothing**.
3. The manager opens **Staff**, sees who is waiting, picks **Counter staff** or **Manager**, and taps **Approve**.
4. The manager can also promote counter staff with **Make manager**, send a password reset link, or remove counter access.
5. Manager accounts cannot be changed or removed from the app (so the shop can never be locked out of its own desk). Do that in SQL.

## Database files (they live in the shop repository's `docs/`)
Run these in the Supabase SQL editor, in this order:

| When | File |
|---|---|
| Already done earlier | `supabase-rls.sql`, `supabase-two-stores.sql`, `supabase-staff-approval.sql`, … |
| **Phase 1**, before deploying this admin | `supabase-counter-manager.sql` (additive: nothing is dropped) |
| **Phase 3**, right before deploying the Maggie's-only shop | `supabase-merge-stores.sql` |
| **Phase 4**, once both sites have run fine for a few days | `supabase-single-store-cleanup.sql` |
| Any time, to enable the **Start fresh** button | `supabase-start-fresh.sql` |

Until Phase 4, existing staff keep their old roles (`store_admin`, `owner`). The desks treat them as
`counter` and `manager`, so nobody is locked out in between.

## Going live (GitHub Pages, admin.maggiescollection.co.ke)
1. Run `supabase-counter-manager.sql`.
2. Push this repository (the `CNAME` file already says `admin.maggiescollection.co.ke`).
3. Supabase > Authentication > URL Configuration > Redirect URLs: add `https://admin.maggiescollection.co.ke/**`.
4. Sign in at `/counter` and `/manager` and check: add a test product with **Show on the rail** unticked, count it,
   sell it, verify a test order, void the sale, and check the Staff tab. (The shop and admin share one database, so a visible test product
   would appear on the live shop.)

## Forgot password
Supabase's built-in email is limited to a few messages an hour, plenty for a small team. The reset link
brings people back to the page they asked from.

## Keeping in step with the shop
`js/config.js` here holds the store name and the departments and types. If you change them in the shop's
config, change them here too (`SHOP.departments`). Never change the store `slug` (`maggies`).

## Changing the pages
Edit `build_admin.py` (page markup) or `js/admin.js` (behaviour), then run `python3 build_admin.py`.
