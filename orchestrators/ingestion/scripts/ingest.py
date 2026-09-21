# -*- coding: utf-8 -*-
"""ingest.py <comp> <round> <target-match-file> <json...>
MatchReport JSON (parser skoreon) -> SQL do skoreova-data. Ověří v kopii, pak zapíše do repozitáře.
Volby přes env: LOANS="Given Family>Team;..." registruje existující osobu k dalšímu týmu (hostování).
"""
import json, sqlite3, sys, os, re, shutil, subprocess, datetime, zoneinfo, tempfile
D="/Users/johndoe/Studio/Development/filipfalcon/skoreova-data"; K="/Users/johndoe/Workspace/Dev/kotkoroid/skoreon"
comp, rnd, target, files = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4:]
ALIAS={'SK Artis Brno Líšeň-Žabovřesky':'SK Artis Brno','FC Viktoria Plzeň "B"':'FC Viktoria Plzeň B','AC Sparta Praha "B"':'AC Sparta Praha B',
 'FC Slovan Liberec "B"':'FC Slovan Liberec B','Lokomotiva Brno H.H.':'Lokomotiva Brno Horní Heršpice','1.FC Slovácko':'1. FC Slovácko',
 'TJ TATRAN Rakovník':'TJ Tatran Rakovník','1.FK Příbram':'1.FK Příbram Akademie','MFK VYŠKOV':'MFK Vyškov','SK Bakov n/J':'SK Bakov nad Jizerou','FC Táborsko':'FC Táborsko Akademie'}
SIB={'FC Viktoria Plzeň B':'FC Viktoria Plzeň','AC Sparta Praha B':'AC Sparta Praha','FC Slovan Liberec B':'FC Slovan Liberec'}; SIB.update({v:k for k,v in SIB.items()})
LOANS={}
for item in filter(None,os.environ.get('LOANS','').split(';')):
    who,tm=item.split('>'); LOANS.setdefault(who.strip(),set()).add(tm.strip())
FEM={'Nikol','Ester','Marit','Macey','Hope','Kess','Flavie','Sofiia','Tinatin','Alexie','Holly','Marie','Lucie','Dagmar','Miriam','Ingrid','Karin','Doris','Iris'}
PRE='019f1af9-b400-7000-8000-'; TS='1782864000000'; tz=zoneinfo.ZoneInfo('Europe/Prague')
ST=tempfile.mkdtemp(prefix='skoreova-stage-'); shutil.copytree(f"{D}/catalog",f"{ST}/catalog"); shutil.copytree(f"{D}/match",f"{ST}/match")
def build(db, migs, files):
    if os.path.exists(db): os.remove(db)
    for m in sorted(subprocess.run(f"ls {migs}/*/migration.sql",shell=True,capture_output=True,text=True).stdout.split()): subprocess.run(f"sqlite3 {db} < '{m}'",shell=True,check=True)
    for f in files: subprocess.run(f"sqlite3 {db} < '{f}'",shell=True,check=True)
    return sqlite3.connect(db)
def catfiles(): return sorted(f"{ST}/catalog/{f}" for f in os.listdir(f"{ST}/catalog"))
def matfiles(): return sorted(f"{ST}/match/{f}" for f in os.listdir(f"{ST}/match"))
mx=subprocess.run(f"cat {ST}/catalog/*.sql {ST}/match/*.sql | grep -oE \"8000-0000000[0-9a-f]{{5}}'\" | tr -d \"'\" | sort | tail -1",shell=True,capture_output=True,text=True).stdout.strip()
n=int(mx[-12:],16)+1; first=n
def i():
    global n; v=f"{PRE}{n:012x}"; n+=1; return v
def append(path, table, rows):
    t=open(path).read(); m=re.search(rf"(INSERT OR IGNORE INTO {table}\n.*?VALUES\n.*?);\n", t, re.S); assert m, table
    open(path,'w').write(t[:m.start()]+m.group(1)+",\n"+rows+";\n"+t[m.end():])
cat=build(f"{ST}/cat.db", f"{K}/services/catalog/migrations", catfiles()); c=cat.cursor()
def team(nm): return ALIAS.get(nm,nm)
def person(fam,giv): return c.execute("select id from persons where family_name=? and given_name=?",(fam,giv)).fetchall()
def regs_of(fam,giv): return c.execute("""select t.name, co.name from persons pe join players pl on pl.person_id=pe.id join registrations r on r.player_id=pl.id
   join participations pa on pa.id=r.participation_id join teams t on t.id=pa.team_id join editions e on e.id=pa.edition_id join competitions co on co.id=e.competition_id
   where pe.family_name=? and pe.given_name=?""",(fam,giv)).fetchall()
def has_part(tm): return bool(c.execute("select 1 from participations pa join teams t on t.id=pa.team_id join editions e on e.id=pa.edition_id join competitions co on co.id=e.competition_id where t.name=? and co.name=?",(tm,comp)).fetchone())
def fix_name(e):
    fam,giv=e['name']['familyName'],e['name']['givenName']; words=(fam+' '+giv).split()
    for k in range(2,len(words)):
        f2,g2=' '.join(words[:k]),' '.join(words[k:])
        if person(f2,g2): e['name']={'familyName':f2,'givenName':g2}; return
# --- pass 1: co chybí v katalogu
R=[json.load(open(f)) for f in files]
NEW_T={}; NEW_P={}; NEW_R={}; NEW_O={}; FLAG=[]
for r in R:
    for side in ('home','away'):
        tm=team(r[side]['name']); assert c.execute('select 1 from teams where name=?',(tm,)).fetchone(), f"neznámý tým {tm}"
        if not has_part(tm): NEW_T[tm]=1
        for e in r[side]['entries']:
            fix_name(e); fam,giv=e['name']['familyName'],e['name']['givenName']
            if any(x==(tm,comp) for x in regs_of(fam,giv)): continue
            elsewhere=regs_of(fam,giv)
            if not elsewhere and not person(fam,giv): NEW_P[(giv,fam,tm)]='GOALKEEPER' if e['isGoalkeeper'] else 'MIDFIELDER'
            elif any(x[0]==SIB.get(tm) for x in elsewhere) or tm in LOANS.get(f"{giv} {fam}",()): NEW_R[(giv,fam,tm)]=1
            else: FLAG.append(f"{fam} {giv} @ {tm}: existuje jinde {elsewhere or '(bez registrace)'}")
    for o in r['officials']:
        giv,fam=o['name']['givenName'],o['name']['familyName']
        if not person(fam,giv): NEW_O[(giv,fam)]='FEMALE' if giv.endswith('a') or giv in FEM else 'MALE'
if FLAG:
    print("NEROZHODNUTO:"); [print("  !!",x) for x in FLAG]; sys.exit(2)
# --- pass 2: zápis katalogu do stage
EDI=c.execute("select e.id from editions e join competitions co on co.id=e.competition_id where co.name=?",(comp,)).fetchone()[0]
PA=[f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{EDI}', '{c.execute('select id from teams where name=?',(tm,)).fetchone()[0]}')" for tm in NEW_T]
if PA: append(f"{ST}/catalog/003-competitions.sql","participations",",\n".join(PA)); cat.close(); cat=build(f"{ST}/cat.db", f"{K}/services/catalog/migrations", catfiles()); c=cat.cursor()
def part(tm): return c.execute("select pa.id from participations pa join teams t on t.id=pa.team_id join editions e on e.id=pa.edition_id join competitions co on co.id=e.competition_id where t.name=? and co.name=?",(tm,comp)).fetchone()[0]
PS,PL,RG=[],[],[]
for (giv,fam,tm),pos in NEW_P.items():
    pid,plid=i(),i(); PS.append(f"  ('{pid}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{giv}', '{fam}', 'FEMALE', 'CZE', '2026-07-01')"); PL.append(f"  ('{plid}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{pid}', '{pos}')")
    RG.append(f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{part(tm)}', '{plid}')")
for (giv,fam,tm) in NEW_R:
    plid=c.execute("select pl.id from players pl join persons pe on pe.id=pl.person_id where pe.given_name=? and pe.family_name=?",(giv,fam)).fetchone()[0]
    RG.append(f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{part(tm)}', '{plid}')")
OF=[f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{g}', '{f}', '{s}', 'CZE', '2026-07-01')" for (g,f),s in NEW_O.items()]
if PS: append(f"{ST}/catalog/004-squads.sql","persons",",\n".join(PS)); append(f"{ST}/catalog/004-squads.sql","players",",\n".join(PL))
if RG: append(f"{ST}/catalog/004-squads.sql","registrations",",\n".join(RG))
if OF: append(f"{ST}/catalog/005-officials.sql","persons",",\n".join(OF))
cat.close(); cat=build(f"{ST}/cat.db", f"{K}/services/catalog/migrations", catfiles()); c=cat.cursor()
print(f"  katalog: +{len(PA)} účastí, +{len(PS)} hráček, +{len(RG)} registrací, +{len(OF)} rozhodčích")
for (g,f,t),p in NEW_P.items(): print(f"    +hráčka   {f} {g} @ {t} ({p})")
for (g,f,t) in NEW_R: print(f"    +registr. {f} {g} -> {t}")
for (g,f),s in NEW_O.items(): print(f"    +rozhodčí {f} {g} ({s})")
# --- pass 3: zápasy
def roster(tm): return {f"{fam} {giv}":rid for rid,fam,giv in c.execute("""select rg.id, pe.family_name, pe.given_name from registrations rg join players pl on pl.id=rg.player_id join persons pe on pe.id=pl.person_id
   join participations pa on pa.id=rg.participation_id join teams t on t.id=pa.team_id join editions e on e.id=pa.edition_id join competitions co on co.id=e.competition_id where t.name=? and co.name=?""",(tm,comp))}
RID=c.execute("select r.id from rounds r join phases ph on ph.id=r.phase_id join editions e on e.id=ph.edition_id join competitions co on co.id=e.competition_id where co.name=? and r.position=?",(comp,rnd)).fetchone()[0]
def pid_of(g,f): r=person(f,g); assert len(r)==1,f"{g} {f}: {len(r)} osob"; return r[0][0]
out=[]
for r in R:
    assert r['round']['position']==rnd or comp=='Penny Cup', f"{r['source']['matchNumber']} je kolo {r['round']['position']}"
    H,A=team(r['home']['name']),team(r['away']['name']); side={'HOME':H,'AWAY':A}; ros={H:roster(H),A:roster(A)}
    ko=int(datetime.datetime.fromisoformat(r['kickoff']['date']+'T'+r['kickoff']['time']).replace(tzinfo=tz).timestamp()*1000)
    sc=r['fullTimeScore']; ht=r['halfTimeScore']; pen=r.get('penaltyShootout')
    hg=sum(1 for g in r['goals'] if g['side']=='HOME'); ag=len(r['goals'])-hg; assert (hg,ag)==(sc['home'],sc['away'])
    hh=sum(1 for g in r['goals'] if g['side']=='HOME' and g['at']['minute']<=45); ah=sum(1 for g in r['goals'] if g['side']=='AWAY' and g['at']['minute']<=45)
    assert ht is None or (hh,ah)==(ht['home'],ht['away']), f"{r['source']['matchNumber']} poločas {hh}:{ah} vs {ht}"
    mid=i(); att='NULL' if r['attendance'] is None else r['attendance']; venue=(r['venue'] or '').replace("'","''")
    N=lambda v:'NULL' if v is None else v
    out.append("INSERT OR IGNORE INTO matches\n  (id, created_at, created_by, updated_at, updated_by, edition_id, round_id, group_id, home_participation_id, away_participation_id, status, number, kickoff_at, timezone, venue, duration_minutes, home_score, away_score, home_half_time_score, away_half_time_score, home_penalty_score, away_penalty_score, attendance)\nVALUES\n"
      f"  ('{mid}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{EDI}', '{RID}', NULL, '{part(H)}', '{part(A)}', 'FINISHED', '{r['source']['matchNumber']}', {ko}, 'Europe/Prague', '{venue}', 90, {sc['home']}, {sc['away']}, {N(ht and ht['home'])}, {N(ht and ht['away'])}, {N(pen and pen['home'])}, {N(pen and pen['away'])}, {att});\n")
    lu={}; regs={}; lr=[]; er=[]
    for s,tm in (('home',H),('away',A)):
        lid=i(); lu[tm]=lid; lr.append(f"  ('{lid}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{mid}', '{part(tm)}')"); seen=set()
        for e in r[s]['entries']:
            who=f"{e['name']['familyName']} {e['name']['givenName']}"; assert who in ros[tm], f"{who} není v soupisce {tm}"
            assert e['shirtNumber'] not in seen, f"{tm} #{e['shirtNumber']} dvakrát"; seen.add(e['shirtNumber'])
            rid=ros[tm][who]; regs[(tm,who)]=rid
            er.append(f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{lid}', '{rid}', '{e['role']}', {e['shirtNumber']}, {1 if e['isStartingCaptain'] else 0})")
    out.append("INSERT OR IGNORE INTO lineups\n  (id, created_at, created_by, updated_at, updated_by, match_id, participation_id)\nVALUES\n"+",\n".join(lr)+";\n")
    out.append("INSERT OR IGNORE INTO lineup_entries\n  (id, created_at, created_by, updated_at, updated_by, lineup_id, registration_id, role, shirt_number, is_starting_captain)\nVALUES\n"+",\n".join(er)+";\n")
    nm=lambda p:f"{p['familyName']} {p['givenName']}"
    def reg(tm,p):
        k=(tm,nm(p))
        if k not in regs:
            words=nm(p).split()
            for kk in range(2,len(words)):
                k2=(tm,' '.join(words[:kk])+' '+' '.join(words[kk:]))
                if k2 in regs: return regs[k2]
        assert k in regs, f"{k} není v sestavě"; return regs[k]
    g=[f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{mid}', '{part(side[x['side']])}', '{reg(side[x['side']] if x['kind']!='OWN_GOAL' else side['AWAY' if x['side']=='HOME' else 'HOME'], x['scorer'])}', '{x['kind']}', {x['at']['minute']}, {N(x['at']['stoppageMinute'])})" for x in r['goals']]
    if g: out.append("INSERT OR IGNORE INTO goals\n  (id, created_at, created_by, updated_at, updated_by, match_id, participation_id, registration_id, kind, minute, stoppage_minute)\nVALUES\n"+",\n".join(g)+";\n")
    cd=[f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{mid}', '{part(side[x['side']])}', '{reg(side[x['side']],x['player'])}', '{x['kind']}', {x['at']['minute']}, {N(x['at']['stoppageMinute'])})" for x in r['cards']]
    if cd: out.append("INSERT OR IGNORE INTO cards\n  (id, created_at, created_by, updated_at, updated_by, match_id, participation_id, registration_id, kind, minute, stoppage_minute)\nVALUES\n"+",\n".join(cd)+";\n")
    sv=[]
    for x in r['substitutions']:
        tm=side[x['side']]; roles={f"{e['name']['familyName']} {e['name']['givenName']}":e['role'] for e in r[x['side'].lower()]['entries']}
        assert roles.get(nm(x['incoming']))=='SUBSTITUTE', f"{nm(x['incoming'])} není náhradnice"
        sv.append(f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{mid}', '{part(tm)}', '{reg(tm,x['outgoing'])}', '{reg(tm,x['incoming'])}', {x['at']['minute']}, {N(x['at']['stoppageMinute'])})")
    if sv: out.append("INSERT OR IGNORE INTO substitutions\n  (id, created_at, created_by, updated_at, updated_by, match_id, participation_id, outgoing_registration_id, incoming_registration_id, minute, stoppage_minute)\nVALUES\n"+",\n".join(sv)+";\n")
    cw=[f"  ('{i()}', {TS}, 'SYSTEM', {TS}, 'SYSTEM', '{mid}', '{pid_of(o['name']['givenName'],o['name']['familyName'])}', '{o['role']}')" for o in r['officials']]
    out.append("INSERT OR IGNORE INTO crew_assignments\n  (id, created_at, created_by, updated_at, updated_by, match_id, person_id, role)\nVALUES\n"+",\n".join(cw)+";\n")
    print(f"  {r['source']['matchNumber']} {H} – {A} {sc['home']}:{sc['away']}  góly={len(r['goals'])} karty={len(r['cards'])} střídání={len(r['substitutions'])}")
open(f"{ST}/match/{target}",'a').write("\n"+"\n".join(out))
# --- verify
mat=build(f"{ST}/mat.db", f"{K}/services/match/migrations", matfiles()); m=mat.cursor(); m.execute(f"ATTACH '{ST}/cat.db' AS cat")
Z,G,S=[m.execute(q).fetchone()[0] for q in ("select count(*) from matches","select count(*) from goals","select count(*) from lineup_entries")]
integ=m.execute("pragma integrity_check").fetchone()[0]
o1=m.execute("select count(*) from lineup_entries le where not exists (select 1 from cat.registrations r where r.id=le.registration_id)").fetchone()[0]
o2=m.execute("select count(*) from crew_assignments ca where not exists (select 1 from cat.persons p where p.id=ca.person_id)").fetchone()[0]
dup=m.execute("select count(*) from (select id from (select id from matches union all select id from goals union all select id from cards union all select id from substitutions union all select id from lineups union all select id from lineup_entries union all select id from crew_assignments union all select id from cat.persons union all select id from cat.players union all select id from cat.registrations union all select id from cat.participations) group by id having count(*)>1)").fetchone()[0]
print(f"  zápasů={Z} gólů={G} sestav={S} integrity={integ} osiřelé reg={o1} crew={o2} duplicitní ID={dup}  ID {first:012x}..{n-1:012x}")
assert integ=='ok' and o1==0 and o2==0 and dup==0
for d in ('catalog','match'):
    for f in os.listdir(f"{ST}/{d}"): shutil.copy(f"{ST}/{d}/{f}", f"{D}/{d}/{f}")
print(f"  zapsáno do {D}; stage {ST}")
