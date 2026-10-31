# Firefly QR Billing

Staff QR-scan billing tool for Firefly Crackers. Mobile web app (PWA) - no server, no account, works offline after first load. All data stays on each device (browser localStorage).

## What it does
- Staff login with a per-device PIN (admin creates staff PINs).
- Point phone camera at a printed product QR sticker -> product card with full details -> enter quantity -> Add to bill.
- Running bill with live total. Scanning the same sticker again increases quantity.
- Admin: import the product catalog Excel, edit prices/products, manage staff, confirm prices.
- The printed QR codes encode only the bare product ID (plain text). Lookup is an exact ID match against the imported catalog - without the catalog a scan shows "not in catalog".

## Setup (one time, per device)
1. Open the app link, tap "Add to Home Screen" (optional but recommended).
2. First run: create an Admin PIN, then in Admin tab add staff (name + PIN).
3. Admin tab -> Import product catalog -> choose `Firefly_Product_Catalog_2026-10-29.xlsx` (from Google Drive). Preview shows row count; confirm.
4. The catalog is the 29 Oct 2026 website snapshot. Confirm prices with the shop owner, then Admin -> Prices confirmation -> "Mark prices confirmed" to remove the warning banner.

## Daily use
- Staff opens the app, taps their name, enters PIN.
- Scan tab: camera starts automatically. If camera is unavailable/denied, type the product ID in the manual box.
- Bill tab: adjust quantities, see total, "New bill (clear)" for the next customer.

## Honest limitations (v1)
- Data is per-device. Bills and price edits do NOT sync between phones. If several staff devices are used, price edits must be made on each device (or re-import the same Excel on each).
- Bills are session-only: no saved bill history, no reports, no bill PDF/print.
- Staff PIN is a convenience gate, not server-grade security - the catalog lives on the device.
- Camera scanning needs HTTPS (this hosting provides it) and camera permission.
- Multi-device sync and real accounts would need a backend (e.g. Supabase) - a future upgrade.

## Privacy
- This repository contains only app code and demo products. The real catalog (products/prices) is never stored here; it is imported at runtime from the private Excel file and stays on the device.

## Testing
- `test.html` runs in-browser self tests (logic, bill math, import validation) and can decode a real sticker PNG through the same scanner library.

## Stack
Plain HTML/CSS/JS, [html5-qrcode](https://github.com/mebjas/html5-qrcode) and [SheetJS](https://sheetjs.com/) vendored locally, service worker for offline. Hosted free on GitHub Pages.
