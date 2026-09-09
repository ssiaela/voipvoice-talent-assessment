#!/usr/bin/env python3
import json, os, secrets, sqlite3, hashlib, hmac, mimetypes
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT=Path(__file__).resolve().parent

def load_env_file(path):
    # Minimal .env loader: keeps local secrets out of source control without extra dependencies.
    if not path.is_file():
        return
    for raw in path.read_text(encoding='utf-8').splitlines():
        line=raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key,value=line.split('=',1)
        key=key.strip(); value=value.strip()
        if value[:1] in ('\"', "'") and value[-1:] == value[:1]:
            value=value[1:-1]
        os.environ.setdefault(key,value)

load_env_file(ROOT/'.env')

STATIC=ROOT/'static'
SEED=ROOT/'seed.json'
_db_path=os.environ.get('VV_DB_PATH','').strip()
DB=Path(_db_path).expanduser() if _db_path else ROOT/'data'/'talent.db'
if not DB.is_absolute():
    DB=(ROOT/DB).resolve()
HOST=os.environ.get('VV_HOST','0.0.0.0')
PORT=int(os.environ.get('PORT',os.environ.get('VV_PORT','8087')))
PUBLIC_BASE_URL=os.environ.get('VV_PUBLIC_BASE_URL','').strip().rstrip('/')
INITIAL_PASSWORD=os.environ.get('VV_INITIAL_PASSWORD','')
SESSION_HOURS=int(os.environ.get('VV_SESSION_HOURS','8'))
PBKDF2_ROUNDS=240000

def utcnow(): return datetime.now(timezone.utc)
def iso(dt=None): return (dt or utcnow()).isoformat()
def db():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=20)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c

def hash_password(password,salt=None):
    salt=salt or secrets.token_bytes(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,PBKDF2_ROUNDS)
    return salt.hex()+':'+digest.hex()

def verify_password(password,stored):
    try:
        sh,dh=stored.split(':',1); salt=bytes.fromhex(sh); expected=bytes.fromhex(dh)
        got=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,PBKDF2_ROUNDS)
        return hmac.compare_digest(got,expected)
    except Exception: return False

def init_db():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS test_versions(
          id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT NOT NULL,created_at TEXT NOT NULL,
          data_json TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS invitations(
          token TEXT PRIMARY KEY,name TEXT NOT NULL,position TEXT,created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,version_id INTEGER NOT NULL,status TEXT NOT NULL,
          answers_json TEXT NOT NULL DEFAULT '{}',result_json TEXT,completed_at TEXT,
          FOREIGN KEY(version_id) REFERENCES test_versions(id));
        CREATE TABLE IF NOT EXISTS sessions(
          token TEXT PRIMARY KEY,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(
          id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,event TEXT NOT NULL);
        ''')
        if not c.execute("SELECT 1 FROM settings WHERE key='password_hash'").fetchone():
            if len(INITIAL_PASSWORD) < 12:
                raise RuntimeError('VV_INITIAL_PASSWORD deve essere impostata e contenere almeno 12 caratteri al primo avvio')
            c.execute("INSERT INTO settings(key,value) VALUES('password_hash',?)",(hash_password(INITIAL_PASSWORD),))
        if not c.execute('SELECT 1 FROM test_versions LIMIT 1').fetchone():
            seed=SEED.read_text(encoding='utf-8')
            c.execute('INSERT INTO test_versions(label,created_at,data_json,is_current) VALUES(?,?,?,1)',('1.0',iso(),seed))
            c.execute('INSERT INTO audit(created_at,event) VALUES(?,?)',(iso(),'Applicazione inizializzata — versione 1.0 importata dall’Excel'))
        c.commit()

def current_version(c):
    return c.execute('SELECT * FROM test_versions WHERE is_current=1 ORDER BY id DESC LIMIT 1').fetchone()

def add_audit(c,text): c.execute('INSERT INTO audit(created_at,event) VALUES(?,?)',(iso(),text))

def normalize_question_score(q,answer_key):
    ans=next((a for a in q.get('answers',[]) if str(a.get('key'))==str(answer_key)),None)
    if not ans: raise ValueError('Risposta non valida')
    vals=[float(a.get('points',0)) for a in q.get('answers',[])]
    if not vals: return 0.0
    lo,hi=min(vals),max(vals); p=float(ans.get('points',0))
    if q.get('type')=='scale' and q.get('scoring',{}).get('inverse'):
        p=lo+hi-p
    return 0.0 if hi==lo else (p-lo)/(hi-lo)*100.0

def calculate_result(data,answers):
    comps={c['name']:{'sum':0.0,'weight':0.0} for c in data['competencies']}
    scen=[]; pw=float(data.get('weights',{}).get('primary',1)); sw=float(data.get('weights',{}).get('secondary',1))
    for q in data['questions']:
        key=str(q['id'])
        if key not in answers: continue
        score=normalize_question_score(q,answers[key])
        if q.get('type')=='scenario': scen.append(score)
        pri=q.get('scoring',{}).get('primary'); sec=q.get('scoring',{}).get('secondary')
        if pri in comps and pw>0:
            comps[pri]['sum']+=score*pw; comps[pri]['weight']+=pw
        if sec in comps and sw>0:
            comps[sec]['sum']+=score*sw; comps[sec]['weight']+=sw
    scores={k:(v['sum']/v['weight'] if v['weight'] else 0.0) for k,v in comps.items()}
    return {'scores':scores,'scenarioScore':sum(scen)/len(scen) if scen else 0.0,'createdAt':iso()}

def public_question(q):
    return {'id':q['id'],'text':q['text'],'type':q['type'],
            'answers':[{'key':a['key'],'text':a['text']} for a in q.get('answers',[])]}

class Handler(BaseHTTPRequestHandler):
    server_version='VoipVoiceTalentDemo/1.0'
    def log_message(self,fmt,*args): print('%s - %s' % (self.address_string(),fmt%args))
    def _json(self,status,payload,headers=None):
        raw=json.dumps(payload,ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def _session_cookie(self,value,max_age):
        forwarded=self.headers.get('X-Forwarded-Proto','').split(',')[0].strip().lower()
        secure=PUBLIC_BASE_URL.lower().startswith('https://') or forwarded=='https'
        suffix='; Secure' if secure else ''
        return f'vv_session={value}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{suffix}'
    def _body(self):
        n=int(self.headers.get('Content-Length','0') or 0)
        if n>2_000_000: raise ValueError('Payload troppo grande')
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}')
    def _cookies(self):
        jar=cookies.SimpleCookie(); jar.load(self.headers.get('Cookie','')); return jar
    def _session(self):
        morsel=self._cookies().get('vv_session')
        if not morsel: return None
        tok=morsel.value
        with db() as c:
            r=c.execute('SELECT * FROM sessions WHERE token=?',(tok,)).fetchone()
            if not r: return None
            if datetime.fromisoformat(r['expires_at'])<utcnow():
                c.execute('DELETE FROM sessions WHERE token=?',(tok,)); c.commit(); return None
            return tok
    def _require_hr(self):
        if not self._session():
            self._json(401,{'error':'Autenticazione HR richiesta'}); return False
        return True
    def _serve_index(self):
        p=STATIC/'index.html'; raw=p.read_bytes(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        u=urlparse(self.path); path=u.path
        if path=='/healthz':
            return self._json(200,{'status':'ok'})
        if path=='/' or path=='/hr' or path.startswith('/c/'):
            return self._serve_index()
        if path.startswith('/static/'):
            f=(ROOT/path.lstrip('/')).resolve()
            if not str(f).startswith(str(STATIC.resolve())) or not f.is_file(): return self.send_error(404)
            raw=f.read_bytes(); self.send_response(200); self.send_header('Content-Type',mimetypes.guess_type(f.name)[0] or 'application/octet-stream'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        if path=='/api/bootstrap':
            with db() as c:
                v=current_version(c)
                return self._json(200,{'authenticated':bool(self._session()),'currentVersion':v['label']})
        if path=='/api/candidate/test':
            token=parse_qs(u.query).get('token',[''])[0]
            with db() as c:
                inv=c.execute('SELECT i.*,v.label,v.data_json FROM invitations i JOIN test_versions v ON v.id=i.version_id WHERE i.token=?',(token,)).fetchone()
                if not inv: return self._json(404,{'error':'Link non valido'})
                expired=datetime.fromisoformat(inv['expires_at'])<utcnow()
                if expired and inv['status']!='completed': return self._json(410,{'error':'Link scaduto'})
                data=json.loads(inv['data_json'])
                payload={'name':inv['name'],'position':inv['position'],'version':inv['label'],'status':inv['status'],'expiresAt':inv['expires_at'],'answers':json.loads(inv['answers_json'] or '{}') if inv['status']!='completed' else {},'questions':[public_question(q) for q in data['questions']]}
                return self._json(200,payload)
        if path=='/api/hr/candidates':
            if not self._require_hr(): return
            with db() as c:
                rows=c.execute('SELECT i.*,v.label FROM invitations i JOIN test_versions v ON v.id=i.version_id ORDER BY i.created_at DESC').fetchall()
                return self._json(200,{'items':[dict(r) | {'answers_json':None,'result_json':None} for r in rows]})
        if path=='/api/hr/results':
            if not self._require_hr(): return
            with db() as c:
                rows=c.execute("SELECT i.token,i.name,i.position,i.completed_at,v.label FROM invitations i JOIN test_versions v ON v.id=i.version_id WHERE i.status='completed' ORDER BY i.completed_at DESC").fetchall()
                return self._json(200,{'items':[dict(r) for r in rows]})
        if path=='/api/hr/result':
            if not self._require_hr(): return
            token=parse_qs(u.query).get('token',[''])[0]
            with db() as c:
                r=c.execute('SELECT i.*,v.label,v.data_json FROM invitations i JOIN test_versions v ON v.id=i.version_id WHERE i.token=? AND i.status=\'completed\'',(token,)).fetchone()
                if not r: return self._json(404,{'error':'Risultato non trovato'})
                data=json.loads(r['data_json'])
                return self._json(200,{'candidate':{'name':r['name'],'position':r['position'],'completedAt':r['completed_at'],'version':r['label']},'result':json.loads(r['result_json']),'config':{'competencies':data['competencies'],'ranges':data['ranges']}})
        if path=='/api/hr/settings':
            if not self._require_hr(): return
            with db() as c:
                v=current_version(c); dr=c.execute("SELECT value FROM settings WHERE key='draft_json'").fetchone()
                data=json.loads(dr['value']) if dr else json.loads(v['data_json'])
                return self._json(200,{'currentVersion':v['label'],'data':data,'hasDraft':bool(dr)})
        if path=='/api/hr/audit':
            if not self._require_hr(): return
            with db() as c:
                aud=[dict(r) for r in c.execute('SELECT created_at,event FROM audit ORDER BY id DESC LIMIT 100')]
                vers=[dict(r) for r in c.execute('SELECT id,label,created_at,is_current FROM test_versions ORDER BY id DESC')]
                for v in vers: v['invitations']=c.execute('SELECT COUNT(*) n FROM invitations WHERE version_id=?',(v['id'],)).fetchone()['n']
                return self._json(200,{'audit':aud,'versions':vers})
        return self.send_error(404)
    def do_POST(self):
        u=urlparse(self.path); path=u.path
        try: body=self._body()
        except Exception as e: return self._json(400,{'error':str(e)})
        if path=='/api/hr/login':
            with db() as c:
                ph=c.execute("SELECT value FROM settings WHERE key='password_hash'").fetchone()['value']
                if not verify_password(str(body.get('password','')),ph): return self._json(401,{'error':'Password non corretta'})
                tok=secrets.token_urlsafe(32); exp=utcnow()+timedelta(hours=SESSION_HOURS)
                c.execute('DELETE FROM sessions WHERE expires_at<?',(iso(),)); c.execute('INSERT INTO sessions(token,created_at,expires_at) VALUES(?,?,?)',(tok,iso(),iso(exp))); add_audit(c,'Accesso HR'); c.commit()
                return self._json(200,{'ok':True},{'Set-Cookie':self._session_cookie(tok,SESSION_HOURS*3600)})
        if path=='/api/hr/logout':
            morsel=self._cookies().get('vv_session')
            with db() as c:
                if morsel: c.execute('DELETE FROM sessions WHERE token=?',(morsel.value,)); c.commit()
            return self._json(200,{'ok':True},{'Set-Cookie':self._session_cookie('',0)})
        if path=='/api/candidate/start':
            token=str(body.get('token',''))
            with db() as c:
                r=c.execute('SELECT * FROM invitations WHERE token=?',(token,)).fetchone()
                if not r:return self._json(404,{'error':'Link non valido'})
                if datetime.fromisoformat(r['expires_at'])<utcnow():return self._json(410,{'error':'Link scaduto'})
                if r['status']=='sent': c.execute("UPDATE invitations SET status='started' WHERE token=?",(token,)); c.commit()
                return self._json(200,{'ok':True})
        if path=='/api/candidate/save':
            token=str(body.get('token','')); answers=body.get('answers') or {}
            with db() as c:
                r=c.execute('SELECT * FROM invitations WHERE token=?',(token,)).fetchone()
                if not r:return self._json(404,{'error':'Link non valido'})
                if r['status']=='completed':return self._json(409,{'error':'Test già completato'})
                if datetime.fromisoformat(r['expires_at'])<utcnow():return self._json(410,{'error':'Link scaduto'})
                c.execute("UPDATE invitations SET answers_json=?,status='started' WHERE token=?",(json.dumps(answers,ensure_ascii=False),token)); c.commit(); return self._json(200,{'ok':True})
        if path=='/api/candidate/submit':
            token=str(body.get('token','')); answers={str(k):str(v) for k,v in (body.get('answers') or {}).items()}
            with db() as c:
                r=c.execute('SELECT i.*,v.data_json,v.label FROM invitations i JOIN test_versions v ON v.id=i.version_id WHERE i.token=?',(token,)).fetchone()
                if not r:return self._json(404,{'error':'Link non valido'})
                if r['status']=='completed':return self._json(409,{'error':'Test già completato'})
                if datetime.fromisoformat(r['expires_at'])<utcnow():return self._json(410,{'error':'Link scaduto'})
                data=json.loads(r['data_json']); required={str(q['id']) for q in data['questions']}
                if set(answers)!=required:return self._json(400,{'error':'Completa tutte le domande prima di inviare'})
                for q in data['questions']:
                    allowed={str(a['key']) for a in q['answers']}
                    if answers[str(q['id'])] not in allowed:return self._json(400,{'error':f'Risposta non valida alla domanda {q["id"]}'})
                result=calculate_result(data,answers)
                c.execute("UPDATE invitations SET answers_json=?,result_json=?,status='completed',completed_at=? WHERE token=?",(json.dumps(answers,ensure_ascii=False),json.dumps(result,ensure_ascii=False),iso(),token)); add_audit(c,f'Test completato da {r["name"]} — versione {r["label"]}'); c.commit(); return self._json(200,{'ok':True})
        if path.startswith('/api/hr/') and not self._require_hr(): return
        if path=='/api/hr/invitations':
            name=str(body.get('name','')).strip(); position=str(body.get('position','')).strip(); days=int(body.get('expiryDays',7) or 7)
            if not name:return self._json(400,{'error':'Nome candidato obbligatorio'})
            days=max(1,min(days,90)); token=secrets.token_urlsafe(24)
            with db() as c:
                v=current_version(c); exp=utcnow()+timedelta(days=days)
                c.execute('INSERT INTO invitations(token,name,position,created_at,expires_at,version_id,status,answers_json) VALUES(?,?,?,?,?,?,\'sent\',\'{}\')',(token,name,position,iso(),iso(exp),v['id'])); add_audit(c,f'Creato invito per {name} — test v{v["label"]}'); c.commit()
                if PUBLIC_BASE_URL:
                    base=PUBLIC_BASE_URL
                else:
                    forwarded=self.headers.get('X-Forwarded-Proto','').split(',')[0].strip().lower()
                    scheme='https' if forwarded=='https' else 'http'
                    host=self.headers.get('X-Forwarded-Host') or self.headers.get('Host',f'localhost:{PORT}')
                    base=f'{scheme}://{host}'
                return self._json(201,{'token':token,'url':f'{base}/c/{token}','version':v['label']})
        if path=='/api/hr/settings/draft':
            data=body.get('data')
            if not isinstance(data,dict) or len(data.get('questions',[]))<1:return self._json(400,{'error':'Configurazione non valida'})
            with db() as c:
                c.execute("INSERT INTO settings(key,value) VALUES('draft_json',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(data,ensure_ascii=False),)); add_audit(c,'Bozza test aggiornata'); c.commit(); return self._json(200,{'ok':True})
        if path=='/api/hr/settings/discard':
            with db() as c:
                c.execute("DELETE FROM settings WHERE key='draft_json'"); add_audit(c,'Bozza test eliminata'); c.commit(); return self._json(200,{'ok':True})
        if path=='/api/hr/settings/publish':
            data=body.get('data')
            if not isinstance(data,dict):return self._json(400,{'error':'Configurazione non valida'})
            with db() as c:
                v=current_version(c)
                try: label=f'{float(v["label"])+0.1:.1f}'
                except: label=str(int(v['id'])+1)
                c.execute('UPDATE test_versions SET is_current=0 WHERE is_current=1')
                c.execute('INSERT INTO test_versions(label,created_at,data_json,is_current) VALUES(?,?,?,1)',(label,iso(),json.dumps(data,ensure_ascii=False)))
                c.execute("DELETE FROM settings WHERE key='draft_json'"); add_audit(c,f'Pubblicata versione test {label}'); c.commit(); return self._json(201,{'ok':True,'version':label})
        if path=='/api/hr/password':
            old=str(body.get('oldPassword','')); new=str(body.get('newPassword',''))
            if len(new)<12:return self._json(400,{'error':'La nuova password deve avere almeno 12 caratteri'})
            with db() as c:
                ph=c.execute("SELECT value FROM settings WHERE key='password_hash'").fetchone()['value']
                if not verify_password(old,ph):return self._json(400,{'error':'Password attuale non corretta'})
                c.execute("UPDATE settings SET value=? WHERE key='password_hash'",(hash_password(new),)); c.execute('DELETE FROM sessions'); add_audit(c,'Password HR modificata'); c.commit()
                return self._json(200,{'ok':True},{'Set-Cookie':self._session_cookie('',0)})
        return self.send_error(404)

if __name__=='__main__':
    try:
        init_db()
    except RuntimeError as exc:
        print(f'Configurazione non valida: {exc}')
        print('Copia .env.example in .env e imposta una password iniziale sicura.')
        raise SystemExit(2)
    local_url=f'http://localhost:{PORT}'
    print(f'VoipVoice Talent Assessment: {PUBLIC_BASE_URL or local_url}/hr')
    print(f'Database: {DB}')
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
