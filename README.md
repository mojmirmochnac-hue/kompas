# Kompas

Osobný plánovač podľa hodnôt, životných rolí, cieľov a princípov 3. návyku
z knihy *7 návykov skutočne efektívnych ľudí*.

## Funkcie

- denný a týždenný plán,
- všetky úlohy a matica priorít,
- roly, ciele, hodnoty a osobné poslanie,
- denník a týždenná reflexia,
- trvalé uloženie cez Netlify Blobs,
- synchronizácia úloh s TickTickom, kde má TickTick pri konflikte prednosť,
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

## TickTick

V Nastaveniach Kompasu sa TickTick pripája cez oficiálny MCP server a OAuth.
Používateľ nevkladá API token ani heslo: prihlási sa priamo na stránke TickTicku
a povolí oprávnenia `tasks:read` a `tasks:write`. Pri prvom spojení Kompas
bezpečne páruje existujúce úlohy podľa názvu, dátumu a času. Potom synchronizuje
pri otvorení, každú minútu počas používania a ručne. Pri súbežnej úprave tej
istej úlohy má prednosť verzia z TickTicku; roly, ciele, kvadranty a veľké
kamene zostávajú v Kompase.

## Nasadenie

Projekt obsahuje `netlify.toml`. Netlify zostaví aplikáciu príkazom
`pnpm build`.
