# Shaanpatti — deploy Firestore rules (akxh-games)

Online lobbies fail with **“Deploy shaanpatti Firestore rules…”** until these rules are live. Pass & play does **not** need this.

Shaanpatti uses **no Firebase Auth**. Lobbies must be readable/writable without `request.auth`.

## Do this in Firebase Console (2 minutes)

1. Open [Firebase Console](https://console.firebase.google.com/) → project **`akxh-games`**
2. Left nav: **Build → Firestore Database → Rules**
3. Replace the **entire** rules document with the contents of  
   `c:\Development\ak-games\shaanpatti\firestore.rules`  
   (also on GitHub: [firestore.rules](https://github.com/AkRypt/shaanpatti/blob/main/firestore.rules))
4. Click **Publish**
5. Hard-refresh Shaanpatti → **Online lobby** again

### Why the full file?

Rules are one document for the whole project. Publishing only the `shaanpatti_*` blocks would wipe Spycy’s rules. The repo file already includes Spycy + Ishaare matches + Shaanpatti open lobby rules.

### What changes for Shaanpatti

```
match /shaanpatti_lobbies/{lobbyId} {
  allow read, create, update: if true;   // no Auth
}
match /shaanpatti_users/{userId} {
  allow read, write: if true;
}
match /shaanpatti_words/{id} {
  allow read: if true;
  allow write: if false;                 // /admin uses Admin SDK
}
match /shaanpatti_packs/{id} {
  allow read: if true;
  allow write: if false;
}
```

Spycy blocks stay Auth-gated (unchanged).

## Optional CLI

```bash
cd c:\Development\ak-games\shaanpatti
firebase login
firebase deploy --only firestore:rules --project akxh-games
```

(Needs Firebase CLI + permission on the project.)

## After publish

- Online create/join should work with only a display name (no login).
- `/admin` pack edits still use Admin SDK + `ADMIN_PASSWORD` (not these client rules).
