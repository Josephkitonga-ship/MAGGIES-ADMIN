# Maggie's Collection — staff desks

Stand-alone admin site, kept apart from the shop (same idea as the Baari admin).
Same Supabase project as the shop, so products, orders and the three logins carry over.

```
index.html     chooser: which desk?
maggie.html    Maggie's Collection desk
david.html     David's Boutique desk
owner.html     owner desk (both boutiques, view only)
css/ js/       styles and scripts
build_admin.py regenerates the four pages
robots.txt     asks search engines to stay out; pages also carry noindex
```

## Who opens what
- Maggie and David: their own desk only (products, orders, verify, own sales).
- Owner: `owner.html` only, view only (sales, discounts, both boutiques).
Enforced by the database (see the shop repository's `docs/` SQL files), not just by these pages.

## Going live (GitHub Pages)
1. New repository `MAGGIES-ADMIN` on GitHub, upload these files, then Settings > Pages > deploy from `main`, root.
2. Address: `https://<your-username>.github.io/MAGGIES-ADMIN/`

## Forgot password
In Supabase: Authentication > URL Configuration > Redirect URLs > add
`https://<your-username>.github.io/MAGGIES-ADMIN/**` and save.
Supabase's built-in email is limited to a few messages an hour, plenty for three staff.

## When the shop gets a domain
- Shop address changes: edit `SHOP_URL` in `build_admin.py`, run `python3 build_admin.py`, push.
- Admin on a subdomain (e.g. `admin.yourdomain`): add a `CNAME` file containing that name, point a DNS
  CNAME record at `<your-username>.github.io`, then add the new address to the Supabase Redirect URLs.

## Keeping in step with the shop
`js/config.js` here holds the two boutique names and the departments and types. If you change them in the shop's
config, change them here too (`SHOP.departments`). Never rename a boutique `slug`.
