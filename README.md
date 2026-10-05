# Discindex

A website for your CD collection, using Discogs for album info.

## Start it

1. Double-click **`start.bat`**. A black window opens. Keep it open.
2. Your browser opens at **http://localhost:8000**.
3. To stop, close the black window.

Needs Python (already installed on this computer).

## First time

1. Click **⚙ → Settings**.
2. Paste your **Discogs token** and **username**, then **Save**.
3. Click **Import my Discogs collection**. It takes about 3 minutes for ~150 items.

## Files

| File | What it does |
|------|--------------|
| `index.html` | All pages of the site |
| `css/style.css` | Colors, layout, phone layout |
| `js/app.js` | Pages, collection views, search, adding CDs, import |
| `js/discogs.js` | Talking to Discogs, turning Discogs data into CDs |
| `js/store.js` | Saving the collection in the browser, backup files |
| `js/scanner.js` | Camera barcode scanning |
| `start.bat` | Starts the site on this computer |

## Good to know

- The collection is saved **in your browser** (on this computer only). Use **Export collection** for backups.
- Each browser has its own copy: Chrome and Edge won't share.
- The camera scanner needs an internet connection (it loads a scanning library).
