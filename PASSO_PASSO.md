# Procedura passo-passo

## A. Supabase

1. Vai su Supabase e crea un nuovo progetto.
2. Scegli nome progetto, password database e regione europea appropriata.
3. Attendi che il progetto risulti pronto.
4. Dal menu laterale apri **SQL Editor**.
5. Clicca **New query**.
6. Apri sul PC `SUPABASE_SETUP.sql`, seleziona tutto e copia.
7. Incolla nel SQL Editor.
8. Premi **Run**.
9. Verifica che la query termini senza errori.

## B. Utente HR

1. In Supabase apri **Authentication → Users**.
2. Crea manualmente l'utente HR con l'email aziendale.
3. Torna in **SQL Editor**.
4. Esegui:

```sql
insert into public.hr_users(user_id)
select id from auth.users
where lower(email)=lower('LA_TUA_EMAIL_HR')
on conflict(user_id) do nothing;
```

5. Sostituisci `LA_TUA_EMAIL_HR` con l'email appena creata.

## C. Collegamento frontend

1. In Supabase apri le impostazioni API del progetto.
2. Copia **Project URL**.
3. Copia la **Publishable key**.
4. Sul PC apri `static/config.js` con Blocco note.
5. Sostituisci i due placeholder.
6. Salva.

## D. Aggiornamento GitHub

1. Copia nel repository locale tutti i file di questa nuova versione, sostituendo quelli precedenti.
2. In GitHub Desktop controlla i file modificati.
3. Summary: `Convert backend to Supabase`.
4. Clicca **Commit to main**.
5. Clicca **Push origin**.

## E. Attivazione GitHub Pages

1. Apri il repository su github.com.
2. Apri **Settings**.
3. Nel menu laterale scegli **Pages**.
4. In **Build and deployment**, imposta **Source = GitHub Actions**.
5. Apri la scheda **Actions**.
6. Attendi che `Deploy to GitHub Pages` diventi verde.
7. Torna in **Settings → Pages** e copia l'indirizzo pubblicato.

Area HR: aggiungi `#hr` alla fine dell'URL.

Esempio:

```text
https://ssiaela.github.io/voipvoice-talent-assessment/#hr
```

Da quel momento il sistema non dipende dal PC locale: browser diversi e persone diverse utilizzano lo stesso database Supabase.
