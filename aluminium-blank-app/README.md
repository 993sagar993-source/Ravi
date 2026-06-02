# Aluminium Blank Business - Client Accounts App

A lightweight web app to track:

- Clients
- Per-client special prices for each size
- Orders/transactions (optional starting point)
- Accounts/ledger (basic structure)

## Run (recommended)

Open `index.html` in a browser (no build step required).

## Data storage

Uses `localStorage` in the browser.

## Notes

- This is a starter app scaffold.
- Pricing model is designed to support special prices per client.

## What I will add next (your requirement)

- A “New Entry” screen:
  - Select client
  - Enter quantity for each variant (6mm-165, 6mm-185, 8mm-185, 10mm-205, 10mm-220, Side Wheel-270)
  - App calculates amount using client special price (or default price)
  - Track Owe (Debit) and Paid (Credit)
- Totals dashboard:
  - Per-client owing & paid
  - Combined totals for all clients
- CSV import/export (instead of JSON) for clients + ledger entries
