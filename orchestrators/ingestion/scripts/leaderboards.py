# -*- coding: utf-8 -*-
"""leaderboards.py [competition...] — builds both databases from skoreova-data into a temp dir and prints
scorers (goals desc, minutes asc, own goals excluded) and keepers.
Keeper score: A = (GA + k·μ)/(min/90 + k), k=3, μ pooled GA per 90 over the competition's keepers;
C1 = 1 − A/max(A); C2 = clean minutes / (90 × matches her team played); score = ½C1 + ½C2.
Outfield players who kept goal are passed as EXTRA_KEEPERS="Family Given>Team>minutes>ga;…"."""
import sqlite3, sys, os, subprocess, tempfile
D="/Users/johndoe/Studio/Development/filipfalcon/skoreova-data"; K="/Users/johndoe/Workspace/Dev/kotkoroid/skoreon"
T=tempfile.mkdtemp(prefix='skoreova-lb-'); INF=10**6
def build(db, migs, files):
    for m in sorted(subprocess.run(f"ls {migs}/*/migration.sql",shell=True,capture_output=True,text=True).stdout.split()): subprocess.run(f"sqlite3 {db} < '{m}'",shell=True,check=True)
    for f in files: subprocess.run(f"sqlite3 {db} < '{f}'",shell=True,check=True)
build(f"{T}/cat.db", f"{K}/services/catalog/migrations", sorted(f"{D}/catalog/{f}" for f in os.listdir(f"{D}/catalog")))
build(f"{T}/mat.db", f"{K}/services/match/migrations", sorted(f"{D}/match/{f}" for f in os.listdir(f"{D}/match")))
db=sqlite3.connect(f"{T}/mat.db"); db.execute(f"ATTACH '{T}/cat.db' AS cat")
def matches(comp): return db.execute("""select m.id, m.home_participation_id, m.away_participation_id, coalesce(m.duration_minutes,90) from matches m
  join cat.rounds r on r.id=m.round_id join cat.phases ph on ph.id=r.phase_id join cat.editions e on e.id=ph.edition_id join cat.competitions c on c.id=e.competition_id where c.name=?""",(comp,)).fetchall()
def spells(mid,pid):
    ent={r[0]:r[1] for r in db.execute("select le.registration_id, le.role from lineup_entries le join lineups l on l.id=le.lineup_id where l.match_id=? and l.participation_id=?",(mid,pid))}
    out={rid:[0,INF] for rid,role in ent.items() if role=='STARTER'}
    for off,on,mi in db.execute("select outgoing_registration_id, incoming_registration_id, minute from substitutions where match_id=? and participation_id=? order by minute",(mid,pid)):
        if off in out: out[off][1]=mi
        out[on]=[mi,INF]
    return out
def ga(mid,opp,lo,hi): return db.execute("select count(*) from goals where match_id=? and participation_id=? and minute>? and minute<=?",(mid,opp,lo,hi)).fetchone()[0]
def who(rid): return db.execute("""select pe.family_name||' '||pe.given_name, t.name, pl.primary_position, pa.id from cat.registrations rg join cat.players pl on pl.id=rg.player_id join cat.persons pe on pe.id=pl.person_id
  join cat.participations pa on pa.id=rg.participation_id join cat.teams t on t.id=pa.team_id where rg.id=?""",(rid,)).fetchone()
def scorers(comp, top=8):
    mins={}; goals={}
    for mid,hp,ap,dur in matches(comp):
        for pid in (hp,ap):
            for rid,(s,e) in spells(mid,pid).items(): mins[rid]=mins.get(rid,0)+min(e,dur)-s
        for rid,k in db.execute("select registration_id, kind from goals where match_id=?",(mid,)):
            if k!='OWN_GOAL': goals[rid]=goals.get(rid,0)+1
    rows=sorted(((g,mins.get(rid,0),rid) for rid,g in goals.items()), key=lambda x:(-x[0],x[1]))
    print(f"\n=== STŘELKYNĚ — {comp}\n  #  hráčka                  klub                        G   min")
    for k,(g,m,rid) in enumerate(rows[:top],1): nm,club,_,_=who(rid); print(f"  {k}  {nm:<23} {club:<27} {g:>2}  {m:>4}")
def keepers(comp, top=8, K_=3.0):
    st={}; tm_={}
    for mid,hp,ap,dur in matches(comp):
        for pid,opp in ((hp,ap),(ap,hp)):
            tm_[pid]=tm_.get(pid,0)+1
            for rid,(s,e) in spells(mid,pid).items():
                if who(rid)[2]!='GOALKEEPER': continue
                played=min(e,dur)-s; con=ga(mid,opp,s,e); r=st.setdefault(rid,[0,0,0]); r[0]+=played; r[1]+=con; r[2]+=played if con==0 else 0
    rows=[(who(rid)[0],who(rid)[1],m,g,c,tm_.get(who(rid)[3],0)) for rid,(m,g,c) in st.items()]
    for item in filter(None,os.environ.get('EXTRA_KEEPERS','').split(';')):
        nm,tm,m,g=item.split('>'); m,g=int(m),int(g)
        pid=db.execute("select pa.id from cat.participations pa join cat.teams t on t.id=pa.team_id join cat.editions e on e.id=pa.edition_id join cat.competitions c on c.id=e.competition_id where t.name=? and c.name=?",(tm,comp)).fetchone()
        if pid: rows.append((nm,tm,m,g,m if g==0 else 0,tm_.get(pid[0],0)))
    tot_min=sum(r[2] for r in rows); tot_ga=sum(r[3] for r in rows); mu=tot_ga/(tot_min/90)
    A={r[0]:(r[3]+K_*mu)/(r[2]/90+K_) for r in rows}; amax=max(A.values())
    sc=sorted(((0.5*(1-A[nm]/amax)+0.5*(c/(90*t) if t else 0),nm,club,m,g,c,(c/(90*t) if t else 0),t) for nm,club,m,g,c,t in rows), reverse=True)
    print(f"\n=== BRANKÁŘKY — {comp}   μ={mu:.4f} ({tot_ga} gólů / {tot_min/90:g} devadesátek)\n  #  brankářka               klub                        min  GA  čisté    CS   skóre  záp")
    for k,(s,nm,club,m,g,c,c2,t) in enumerate(sc[:top],1): print(f"  {k}  {nm:<23} {club:<27} {m:>4} {g:>3} {c:>6}  {c2:.2f}   {s:.3f}  {t:>3}")
def standings(comp):
    rows=db.execute("""select r.position, ht.name, at.name, m.home_score, m.away_score from matches m join cat.rounds r on r.id=m.round_id join cat.phases ph on ph.id=r.phase_id join cat.editions e on e.id=ph.edition_id join cat.competitions c on c.id=e.competition_id
      join cat.participations hp on hp.id=m.home_participation_id join cat.teams ht on ht.id=hp.team_id join cat.participations ap on ap.id=m.away_participation_id join cat.teams at on at.id=ap.team_id where c.name=? order by r.position""",(comp,)).fetchall()
    T_={}
    for rd,h,a,hs,as_ in rows:
        for t,gf,g in ((h,hs,as_),(a,as_,hs)):
            x=T_.setdefault(t,dict(p=0,w=0,d=0,l=0,gf=0,ga=0,pts=0,form=''))
            r='W' if gf>g else 'D' if gf==g else 'L'; x['p']+=1; x[r.lower()]+=1; x['gf']+=gf; x['ga']+=g; x['pts']+={'W':3,'D':1,'L':0}[r]; x['form']+=r
    print(f"\n=== TABULKA — {comp}\n  #  tým                              Z  V  R  P   skóre  B  forma")
    for k,(t,x) in enumerate(sorted(T_.items(), key=lambda kv:(-kv[1]['pts'],-(kv[1]['gf']-kv[1]['ga']),-kv[1]['gf'])),1):
        print(f"  {k:>2} {t:<32} {x['p']}  {x['w']}  {x['d']}  {x['l']}  {x['gf']:>2}:{x['ga']:<3} {x['pts']:>2}  {x['form']}")
if __name__=='__main__':
    for comp in sys.argv[1:] or ['FORTUNA LYGA','2. liga žen']: standings(comp); scorers(comp); keepers(comp)
