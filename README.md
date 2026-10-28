# Shaanpatti

Wrong-answers-only party game — everyone writes a hilarious wrong answer, anonymous reveal, vote best, then names + points.

- **No Firebase Auth** — display name + UUID in `localStorage`
- **Online lobbies** via Firestore (`shaanpatti_lobbies`) with **open rules** (no `request.auth`)
- **Pass & play** fully local (sessionStorage)
- Packs in Firestore (`shaanpatti_words` / `shaanpatti_packs`); `/admin` password editor (Admin SDK)

## Flow

1. Lobby — packs + answer timer (default 120s) · Start (≥3)
2. **Answering** — write a wrong answer (timer or until all done); host can skip question
3. **Reveal anon** — shuffled anonymous board → host starts voting
4. **Voting** — pick best answer (self-vote OK); required, no skip vote
5. **Reveal names** — +1 per vote · cumulative scores → host Next

## Stack

Next.js 15 (App Router) · React 19 · Node 24 · Firebase `akxh-games` (Firestore + Analytics only) · jose override `4.15.9`

## Firestore rules

Publish the full `firestore.rules` from this repo on **akxh-games** (keeps Whozzit / Spycy / Ishaare too).

```bash
firebase deploy --only firestore:rules --project akxh-games
```

## Local

```bash
cp .env.example .env.local   # fill Firebase web + Admin + ADMIN_PASSWORD
npm install
npm run dev                  # http://localhost:3000
npm run seed                 # optional: push seed packs
```

## Collections

- `shaanpatti_lobbies`
- `shaanpatti_words` / `shaanpatti_packs`
- `shaanpatti_users` (optional name/presence; keyed by local UUID)

**Do not enable Anonymous Auth for Shaanpatti** — it is unused.
