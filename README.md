# DAWS BET AI

Football probability-analysis platform: responsive web app (Android-first, also iPhone, tablet, desktop), a statistical prediction engine, AI Bet Machine, daily combinations, Free/VIP/Premium tiers and a full admin dashboard.

Original code, branding and design. Zero npm dependencies: Node.js 22.13+ with built-in SQLite and HTTP.

## Run it

```bash
cp .env.example .env        # then edit: API_FOOTBALL_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
npm start                   # http://localhost:3000
npm test                    # 25 automated tests
npm run create-admin -- you@example.com "a-strong-password"
```

Without an API key the app runs and shows clear empty states. It never invents data.

## Connect real football data and odds

1. Get your own key from API-Football (api-sports.io) on a plan whose terms allow your use (display, commercial, redistribution).
2. Put it in `.env` as `API_FOOTBALL_KEY`. Keys stay on the server; the browser never sees them.
3. Set `API_DAILY_LIMIT` to your plan quota (free = 100/day). A hard budget stops requests beyond it; live polling may use at most 60%.

**Swapping provider:** add `src/providers/yourProvider.js` implementing the interface documented at the top of `src/providers/index.js`, register it there, set `FOOTBALL_PROVIDER`.

> The API-Football adapter was written from the v3 documentation but could not be exercised against the live service in the build environment (no network). On first connect, open Admin > System and Admin > Matches to confirm fixtures, odds markets and team stats arrive as expected. Odds market names are mapped in `normaliseBet()` in `src/providers/apiFootball.js`; adjust there if your plan names a market differently.

## How predictions work

- Poisson / Dixon-Coles model. Expected goals per side come from venue-specific attack and defence strength shrunk toward league averages, then adjusted for recent form, xG (when supplied), head-to-head scoring, table position and injuries, and lightly blended (30%) with de-margined bookmaker consensus.
- One score grid yields 1X2, double chance, over/under goals, BTTS, Asian handicap (half lines), half-time markets and correct score. Corners and cards are predicted only if the provider supplies per-team averages; otherwise only their odds are shown.
- **Confidence** = probability scaled by data quality, reduced when the model is far more bullish than the market. Labels use admin-editable thresholds (default 95/90/80/70).
- **Honesty rules:** thin data produces no prediction; a pick requires a real bookmaker price at or above the minimum odds; every explanation states it is not a guarantee.
- **Accuracy tracking:** one AI pick per match is recorded and settled automatically after full time. Admin > History shows hit rate against the model's own predicted probability and flat-stake ROI, so you can see whether it is calibrated before relying on it.

## Tiers

Free / VIP / Premium with feature matrix editable in Admin > Settings. Locking is enforced on the server (locked selections are never sent to the browser). **Unlock Everything** is an admin switch, on by default outside production, off in production. Plans are assigned by admins; **no payment processor is integrated.**

## Layout

```
server.js            entry          src/engine/     Poisson model, labels, settlement, explanations
src/db.js            SQLite schema  src/providers/  provider interface + API-Football adapter
src/auth.js          scrypt + JWT   src/services/   football, odds, predictions, accumulators, access
src/routes/          public + admin public/         mobile-first SPA (ui.js, app.js, admin.js)
test/                engine + full-stack tests (fake provider lives only here)
```

Tables: users, admin_users, teams, competitions, matches, odds, predictions, prediction_history, favorites, subscriptions, notifications, settings (+ banners, standings, match_extras, prediction_categories, api_cache).

## Before launch

- Set `NODE_ENV=production` and a long random `JWT_SECRET`; serve over HTTPS (reverse proxy).
- Turn **Unlock Everything** off.
- Confirm your data provider licence covers public display.
- Review the responsible-gambling text in Admin > Settings for your jurisdiction; check local rules on gambling-related content and age gating.
- Back up `data/dawsbet.db`.
