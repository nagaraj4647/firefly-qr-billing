# Firefly QR Billing

Staff QR-scan billing tool for Firefly Crackers. Mobile web app (PWA) with a Supabase backend: secure staff accounts, one shared catalog, live prices on every device.

## What it does
- Staff sign in with their own email + password (Supabase Auth). Roles: admin and staff. Disabled accounts cannot sign in.
- Point phone camera at a printed product QR sticker -> product card with full details -> enter quantity -> Add to bill.
- Running bill with live total. Scanning the same sticker again increases quantity.
- Admin: import the product catalog Excel once (syncs to every device), edit prices/products, create staff accounts, enable/disable staff, confirm prices.
- The printed QR codes encode only the bare product ID (plain text). Lookup is an exact ID match against the shared catalog.

## Setup (one time)
1. Admin opens the app link and signs in with the admin account.
2. Admin tab -> Import product catalog -> choose `Firefly_Product_Catalog_2026-10-29.xlsx` (from Google Drive). Preview shows row count; confirm. The catalog uploads to Supabase and every staff device syncs it at sign-in.
3. Admin tab -> Staff -> add each staff member (name, email, password). Share the credentials with them; they can change their password after signing in.
4. The catalog is the 29 Oct 2026 website snapshot. Confirm prices with the shop owner, then Admin -> Prices confirmation -> "Mark prices confirmed" to remove the warning banner (applies on all devices).

## Daily use
- Staff opens the app, signs in with their email + password. "Add to Home Screen" optional but recommended.
- Scan tab: camera starts automatically. If camera is unavailable/denied, type the product ID in the manual box.
- Bill tab: adjust quantities, see total, "New bill (clear)" for the next customer.

## Security model
- Server-enforced: Supabase Auth for sign-in; Row Level Security on every table. Anyone can read products only after sign-in; only admins can change products, settings, or staff.
- The public anon/publishable key in this repo is safe by design - RLS policies enforce the access rules server-side.
- Public sign-up is disabled; staff accounts are created only by the admin from inside the app.
- Bills are session-only on the device: no saved bill history, no reports, no bill PDF/print (deliberate scope).
- Offline: the last synced catalog is cached on the device so scanning keeps working; catalog changes require a connection.
- Camera scanning needs HTTPS (this hosting provides it) and camera permission.

## Privacy
- This repository contains only app code and demo products. The real catalog (products/prices) lives in the private Supabase project and is never stored here.

## Testing
- `test.html` runs in-browser self tests (logic, bill math, import validation, backend row mapping) and can decode a real sticker PNG through the same scanner library.

## Stack
Plain HTML/CSS/JS + Supabase (Auth, Postgres, RLS). [html5-qrcode](https://github.com/mebjas/html5-qrcode), [SheetJS](https://sheetjs.com/) and [supabase-js](https://github.com/supabase/supabase-js) load from CDN (SRI-pinned) and are cached by the service worker for offline app load. Hosted free on GitHub Pages.
