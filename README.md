# NEST napi időrögzítő

Belépős webplatform a kollégák napi időráfordításának rögzítésére. A feladatok a
ClickUp-ból jönnek (csak olvasás), az idő a saját, privát adatbázisba kerül a
belépett kollégához kötve. Mindenki csak a sajátját látja; az összesített
kimutatást csak a vezetők.

## Stack
- Next.js 14 (App Router) — Vercelre telepítve
- NextAuth — Google-belépés, @nestcom.hu domainre zárva
- @vercel/postgres — időadatok privát tárolása
- ClickUp REST API — feladatok + felelősök (szerveroldali token)

## Fő funkciók
- Google-belépés (céges fiók), személyenként elkülönített nézet
- Napi feladatok behívása felelős szerint, altaszkokkal, ügyfél (space) szerint csoportosítva
- Tevékenységtípus (ABC-sorrend, „Egyéb" a végén) + gyors időbevitel gombokkal
- Napi lap mentése/újraküldése
- Kimutatás: kolléga → ügyfél → tevékenység bontás, altaszk→szülő rollup (vezetőnek összesített, kollégának saját)

## Éles bekapcsoláshoz szükséges (3 titok + adatbázis)
Állítsd be ezeket Vercel környezeti változóként (lásd `.env.example`):

1. **CLICKUP_TOKEN** — ClickUp → Settings → Apps → Personal API Token (`pk_...`).
   `CLICKUP_TEAM_ID` már be van állítva: `2410883`.
2. **Google OAuth** — Google Cloud Console → APIs & Services → Credentials →
   „OAuth client ID" (Web application). Engedélyezett redirect URI:
   `https://<domain>/api/auth/callback/google`.
   → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. `ALLOWED_DOMAIN=nestcom.hu`.
3. **NEXTAUTH_SECRET** — hosszú véletlen string (`openssl rand -base64 32`),
   `NEXTAUTH_URL` = az éles URL.
4. **MANAGER_EMAILS** — kik látják az összesített riportot (vesszővel).
5. **Postgres** — Vercel → Storage → Postgres (Neon). A csatolás után a
   `POSTGRES_URL` automatikusan bekerül. A tábla első használatkor létrejön.

## Helyi futtatás
```
cp .env.example .env.local   # töltsd ki
npm install
npm run dev
```
