# Gianji's Kitchen — Mise

Ricettario personale minimalista, sviluppato in HTML, CSS e JavaScript senza dipendenze di build.

## Funzioni

- Creazione, modifica ed eliminazione delle ricette
- Foto, ingredienti, passaggi, note, categorie e preferiti
- Ricerca per nome e ingrediente
- Ricalcolo delle quantità in base alle porzioni
- Esportazione e importazione di backup JSON

## Dati e privacy

Le ricette vengono salvate **solo nel browser** tramite IndexedDB (con fallback a localStorage). Non sono inviate a GitHub o a un database online e non si sincronizzano automaticamente tra dispositivi. Esporta periodicamente un backup da **Archivio e backup**.

## Avvio

Apri `index.html` oppure ospita i tre file (`index.html`, `style.css`, `app.js`) su un host statico. L'hosting attuale è privato e separato da questo repository: [Mise](https://mise-ricette-gianji-261102.flutedgrass.chatgpt.site).

**Attenzione:** rendere pubblico il repository o abilitare GitHub Pages può esporre il codice o il sito. Questo repository è pensato per restare privato. Gli aggiornamenti pubblicati su ChatGPT Sites non vengono trasferiti automaticamente qui.
