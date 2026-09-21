# Ingestion scripts

Manual pipeline from a saved fotbal.cz match page to `skoreova-data`, until the ingestion worker replaces it.

1. `node scripts/parse-page.ts <page.html> > report.json` — runs `parseFacrMatchPage` on a saved page (run from `orchestrators/ingestion`).
2. `python3 scripts/ingest.py "<competition>" <round> <match-file> <report.json...>` — resolves teams, players and officials against the catalog, appends new persons, registrations and participations, generates the match SQL, verifies a rebuild in a temporary copy and only then writes into the data repository. Cross-club namesakes stop the run; a loan is declared with `LOANS="Given Family>Team"`.
3. `python3 scripts/leaderboards.py [competition...]` — scorers and keepers from a local build of both databases.

Paths to the two repositories are at the top of each script.
