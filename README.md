# VoipVoice Talent Assessment — Supabase edition

Versione online e multiutente del questionario attitudinale HR.

## Architettura

- **Frontend:** HTML/CSS/JavaScript statico, pubblicabile con GitHub Pages.
- **Backend e database:** Supabase PostgreSQL.
- **Login HR:** Supabase Auth (email + password).
- **Candidati:** accesso tramite token personale, senza account.
- **Scoring:** calcolato esclusivamente nel database; non viene inviato al browser del candidato.
- **Storico:** ogni invito resta legato alla versione del test con cui è stato creato.

Il frontend pubblico contiene solo l'interfaccia. `seed.json`, `SUPABASE_SETUP.sql` e la logica di scoring restano nel repository privato e non vengono pubblicati da GitHub Pages.

## File principali

```text
.
├── .github/workflows/pages.yml
├── README.md
├── SUPABASE_SETUP.sql
├── seed.json
├── static/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── config.js
│   └── .nojekyll
└── supabase/
    └── migrations/
        └── 202609090001_initial.sql
```

## Configurazione rapida

### 1. Crea il progetto Supabase

Crea un nuovo progetto su Supabase e attendi che il database sia pronto.

### 2. Inizializza il database

Apri **SQL Editor** in Supabase, crea una nuova query, incolla tutto il contenuto di `SUPABASE_SETUP.sql` e premi **Run**.

Lo script crea:

- whitelist utenti HR;
- versioni del test;
- bozza impostazioni;
- inviti candidato;
- risposte e risultati;
- audit log;
- funzioni RPC candidate/HR;
- 40 domande reali e scoring iniziale v1.0.

Le tabelle hanno RLS attivo e non concedono accesso diretto ai ruoli browser `anon` e `authenticated`.

### 3. Crea l'utente HR

In Supabase vai in **Authentication → Users** e crea manualmente l'utente HR con email e password.

Poi torna nel SQL Editor ed esegui, sostituendo l'email:

```sql
insert into public.hr_users(user_id)
select id from auth.users
where lower(email)=lower('hr@voipvoice.it')
on conflict(user_id) do nothing;
```

Solo gli utenti presenti in `hr_users` possono usare le funzioni HR.

### 4. Collega il frontend a Supabase

Dal progetto Supabase copia:

- Project URL;
- Publishable key.

Apri `static/config.js` e sostituisci i placeholder:

```js
export const VV_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxx',
  APP_URL: ''
};
```

La Publishable Key è progettata per essere usata nel browser. Non inserire mai secret key/service-role key in `static/config.js`.

### 5. Pubblica con GitHub Pages

Fai commit/push dei nuovi file sul repository GitHub.

In GitHub vai in:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

La workflow `.github/workflows/pages.yml` pubblicherà esclusivamente la cartella `static/`.

L'URL sarà normalmente:

```text
https://TUO-USERNAME.github.io/voipvoice-talent-assessment/
```

Area HR:

```text
https://TUO-USERNAME.github.io/voipvoice-talent-assessment/#hr
```

I link candidato vengono generati automaticamente così:

```text
https://TUO-USERNAME.github.io/voipvoice-talent-assessment/?candidate=TOKEN
```

Se usi un dominio personalizzato, puoi impostarlo in GitHub Pages e facoltativamente valorizzare `APP_URL` in `static/config.js`.

## Sicurezza

- Il candidato non riceve punti, competenze associate, item inversi o risultati.
- I token candidato sono salvati nel database solo come hash SHA-256.
- Le funzioni candidato accettano esclusivamente un token valido e non espongono dati HR.
- Le funzioni HR richiedono sia un utente Supabase autenticato sia la presenza nella tabella `hr_users`.
- Le tabelle applicative non sono interrogabili direttamente dal frontend.
- Il cambio password usa Supabase Auth.

Prima dell'uso con candidati reali vanno definite anche retention dei dati, privacy/GDPR, backup e procedure di gestione accessi.

## Nota GitHub Pages

GitHub Pages su repository **privati** richiede un piano GitHub che supporti Pages private (ad esempio Pro/Team/Enterprise). Se il tuo piano non lo consente, la cartella `static/` può essere pubblicata senza modifiche su un altro hosting statico, mantenendo Supabase come backend.
