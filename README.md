# Kompas

Osobný plánovač podľa hodnôt, životných rolí, cieľov a princípov 3. návyku
z knihy *7 návykov skutočne efektívnych ľudí*.

## Funkcie

- denný a týždenný plán,
- všetky úlohy a matica priorít,
- roly, ciele, hodnoty a osobné poslanie,
- denník a týždenná reflexia,
- trvalé uloženie cez Netlify Blobs,
- obojsmerná synchronizácia úloh s Google Calendar.

## Lokálny vývoj

```bash
pnpm install
pnpm dev
```

Pri lokálnom vývoji sa dáta ukladajú do ignorovaného súboru
`.kompas-local.json`. Na Netlify sa používajú Netlify Blobs.

## Google Calendar

V Google Cloud Console je potrebné vytvoriť OAuth klienta typu Web application,
zapnúť Google Calendar API a ako presmerovanie použiť adresu zobrazenú v
Nastaveniach aplikácie. Client ID a Client Secret sa ukladajú na serveri.

## Nasadenie

Projekt obsahuje `netlify.toml`. Netlify zostaví aplikáciu príkazom
`pnpm build`.
