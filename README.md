# VoipVoice Talent Assessment

Applicazione interna per la gestione di un questionario attitudinale pre-colloquio.

Il progetto contiene due aree nettamente separate:

- **Area candidato**: accessibile solo tramite link personale; mostra esclusivamente il questionario assegnato.
- **Area HR**: protetta da password; consente di creare inviti, consultare risultati, modificare domande/risposte/scoring e pubblicare nuove versioni del test.

La configurazione iniziale del questionario deriva dal file Excel fornito al progetto ed è salvata in `seed.json`.

> Nota metodologica: questo strumento è pensato come supporto interno al colloquio. Non è un test psicometrico validato e non dovrebbe essere utilizzato come unico criterio di esclusione.

## Struttura del progetto

```text
.
├── .env.example
├── .gitignore
├── .github/workflows/checks.yml
├── Dockerfile
├── README.md
├── requirements.txt
├── seed.json
├── server.py
├── AVVIA_WINDOWS.bat
├── avvia_mac_linux.sh
└── static/
    └── index.html
```

Il database SQLite viene creato a runtime e **non deve essere versionato su GitHub**.

## Avvio locale

### 1. Configurazione

Copia `.env.example` in un nuovo file chiamato `.env`.

Imposta almeno:

```env
VV_INITIAL_PASSWORD=una-password-lunga-e-sicura
```

La password iniziale deve contenere almeno 12 caratteri. Viene usata soltanto quando il database viene inizializzato per la prima volta. Successivamente può essere modificata dall'area HR.

Il file `.env` è escluso da Git tramite `.gitignore`.

### 2. Avvio su Windows

Fai doppio clic su:

```text
AVVIA_WINDOWS.bat
```

oppure da terminale:

```bash
python server.py
```

### 3. Avvio su macOS/Linux

```bash
./avvia_mac_linux.sh
```

oppure:

```bash
python3 server.py
```

### 4. Apertura area HR

Per impostazione predefinita:

```text
http://localhost:8087/hr
```

Health check:

```text
http://localhost:8087/healthz
```

## Variabili d'ambiente

| Variabile | Descrizione | Default |
| --- | --- | --- |
| `VV_INITIAL_PASSWORD` | Password HR usata solo per inizializzare un nuovo database | nessuno, obbligatoria al primo avvio |
| `VV_HOST` | Interfaccia di rete su cui ascolta il server | `0.0.0.0` |
| `VV_PORT` | Porta locale | `8087` |
| `PORT` | Porta fornita da alcune piattaforme hosting; ha precedenza su `VV_PORT` | nessuno |
| `VV_PUBLIC_BASE_URL` | URL pubblico usato per generare i link candidati | derivato dalla richiesta HTTP |
| `VV_DB_PATH` | Percorso del database SQLite | `data/talent.db` |
| `VV_SESSION_HOURS` | Durata della sessione HR | `8` |

Esempio per produzione:

```env
VV_INITIAL_PASSWORD=imposta-questa-variabile-nei-secrets-del-provider
VV_PUBLIC_BASE_URL=https://assessment.voipvoice.it
VV_DB_PATH=/data/talent.db
```

Non salvare mai password reali nel repository o in `.env.example`.

## Versionamento del test

Quando HR modifica domande, risposte o scoring:

1. le modifiche vengono salvate come bozza;
2. la pubblicazione crea una nuova versione del test;
3. i nuovi inviti utilizzano la nuova versione;
4. candidati e risultati già esistenti restano associati alla versione precedente.

Questo evita modifiche retroattive ai risultati storici.

## Dati che il candidato non riceve

Le API candidate espongono soltanto:

- testo delle domande;
- alternative di risposta;
- stato del proprio test.

Punti, competenze associate, chiavi di scoring e risultati restano lato server e sono disponibili soltanto alle API HR autenticate.

## Database e dati personali

SQLite viene creato nel percorso configurato da `VV_DB_PATH`. Per default:

```text
data/talent.db
```

`data/`, `*.db`, `*.sqlite` e `*.sqlite3` sono esclusi da Git.

Prima dell'uso con candidati reali è necessario definire almeno:

- politica di conservazione e cancellazione dei dati;
- backup del database;
- accessi HR e ruoli;
- HTTPS;
- protezioni contro tentativi di login ripetuti;
- hardening CSRF/sessioni;
- monitoraggio e logging appropriati.

## Docker

Il repository include un `Dockerfile`.

Build:

```bash
docker build -t voipvoice-talent-assessment .
```

Esempio di avvio locale con volume persistente:

```bash
docker run --rm -p 8087:8087 \
  -e VV_INITIAL_PASSWORD='una-password-lunga-e-sicura' \
  -e VV_PUBLIC_BASE_URL='http://localhost:8087' \
  -v "$(pwd)/data:/data" \
  voipvoice-talent-assessment
```

In produzione il volume `/data` deve essere persistente se si continua a usare SQLite.

## Controlli GitHub

La workflow `.github/workflows/checks.yml` esegue automaticamente a ogni push/pull request:

- verifica sintattica di `server.py`;
- validazione JSON di `seed.json`.

## Cosa NON caricare su GitHub

Non committare:

- `.env`;
- database SQLite;
- esportazioni con dati dei candidati;
- backup del database;
- password, token o altri segreti.

Il repository dovrebbe essere **privato**, perché `seed.json` contiene domande e logica del test.
