# Gianji's Kitchen — Mise

Ricettario personale, sviluppato in HTML, CSS e JavaScript. Funziona come sito statico, senza account, login, backend o dipendenze da piattaforme di creazione del sito.

## Funzioni

- Creazione, modifica ed eliminazione delle ricette
- Foto, ingredienti alternativi, sezioni di preparazione, note, categorie e preferiti
- Ricerca per nome e ingrediente
- Ricalcolo delle quantità in base alle porzioni
- Lista della spesa
- Esportazione globale JSON (ricette, foto, lista della spesa) e per singola ricetta
- Importazione singola ricetta senza sovrascritture; importazione globale che sostituisce l'intero archivio, con doppia conferma

## Dati e privacy

Le ricette e la lista della spesa sono salvate **solo sul dispositivo e nel browser in uso** tramite IndexedDB (con fallback a localStorage). Non vengono caricate su GitHub né condivise tra utenti o dispositivi.

Ogni visitatore può utilizzare il proprio ricettario senza registrarsi. La navigazione privata, la cancellazione dei dati del sito o il cambio di browser/dispositivo possono far perdere l'archivio locale: è consigliato esportare periodicamente un backup JSON da **Archivio e backup**.

**Importazione globale:** accetta solo backup completi di Mise e, dopo due conferme, elimina tutte le ricette e la lista della spesa attualmente salvate nel browser, sostituendole con quelle del file. Prima di usarla è opportuno esportare una copia globale dei dati attuali. L'**importazione singola** aggiunge invece una ricetta JSON, ignorando quelle identiche e preservando i dati esistenti.

Se si passa a un nuovo indirizzo web, i dati memorizzati sotto il vecchio indirizzo **non vengono trasferiti automaticamente**: esportare il backup dal vecchio sito e importarlo nel nuovo.

## Pubblicazione con GitHub Pages

Il sito utilizza `index.html` nella radice del ramo `main` e percorsi relativi per CSS e JavaScript, quindi può essere pubblicato direttamente con GitHub Pages:

1. Rendere pubblico il repository nelle impostazioni GitHub.
2. In **Settings → Pages**, scegliere **Deploy from a branch**.
3. Selezionare **main**, cartella **/(root)**, e salvare.
4. Aprire `https://gianji.github.io/Gianji-s-Kitchen/` dopo la pubblicazione.

Il sito pubblicato è visitabile da chiunque abbia il link, senza effettuare login a GitHub o ad altri servizi.
