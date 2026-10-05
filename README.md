# Maria's PDF Tools ♡

A cute, self-hosted collection of PDF tools (inspired by PDF24). Pick a tool from the home page.
Light tools run entirely in the browser; heavy ones (Office conversions, OCR, compression, PDF/A,
encryption, redaction, …) run on the server inside the same container. Files are never sent anywhere else.

The home page groups the tools by what they do: **Make a PDF** (any file → PDF), **Adjust a PDF**
(PDF in, PDF out), **PDF to other files**, **Create & design** and **Images & extras**. Tap ☆ on a tool
to pin it to the top, and click a group's title to fold it away. 🎀 *Customize* has colour themes,
light/dark mode, background patterns and colour, the home page layout (card style, columns, group
order and visibility) and the animal buddies (mascot, friends on/off, and 0–3 friends living along the bottom who wander
about and sit, nap, drink, eat, groom, play, stretch or chase butterflies — click one to say hi). Everything is remembered in the browser.

![Home page with favourites, group filters and search](ReadMeScreenshots/home.png)

| Customize: home page layout | Create card |
| --- | --- |
| ![Customize dialog, Layout tab](ReadMeScreenshots/customize.png) | ![Create card tool with the party invitation template](ReadMeScreenshots/create-card.png) |

## Run it

```sh
docker compose up -d --build
```

Then open <http://localhost:8090> (on a NAS: `http://<nas-ip>:8090`). Stop it with `docker compose down`.

The first build takes a while (LibreOffice, Tesseract OCR, Ghostscript and Chromium are installed).
The image is large (~3.7 GB) but everything works offline once built.

Settings in `docker-compose.yml`:
- `8090:8080` – change the left number to use a different port
- `MAX_UPLOAD_MB` – largest file the server accepts
- `HEAVY_JOBS`, `OCR_THREADS` (optional) – how many heavy conversions may run at once and how many
  threads OCR uses. Automatic: 1/1 on a NAS (or container limit) under 3 GB of RAM, else 2/2.
  `http://<nas>:8090/api/info` shows what was picked.
- `tmpfs /tmp:size=2g` – working files are kept in RAM; lower it on a NAS with little RAM.

Memory: idle ≈ 80–100 MB. While working, a job adds roughly: LibreOffice/Chromium 150 MB,
Ghostscript 15 MB, PDF → Word/Markdown 250–350 MB, OCR 370 MB (low-RAM mode) to 550 MB.
Jobs that need big libraries run in a short-lived helper process, so their memory is returned
as soon as they finish.

> There is no login. Keep it on your home network, or put it behind your NAS's VPN / reverse proxy with authentication.

## Project layout

```
web/            browser app (no build step)
  js/main.js    router + home page (filters, favourites, buddy settings)
  js/registry.js  list of tools, their categories and groups
  js/core.js    shared helpers (drop zones, options forms, results, zooming, API calls)
  js/editor.js  page viewer + editor used by View / Edit / Sign / Make fillable / Redact
  js/imagepdf.js  images → PDF pages (used by Convert to PDF)
  js/prefs.js   preferences saved in the browser (favourites, look, layout, buddies)
  js/theme.js   colour themes, light/dark mode and backgrounds
  js/settings.js  the Customize dialog
  js/cats.js    the pixel-art animals
  js/pals.js    the friends living along the bottom of the window
  js/tools/     one module per tool
  vendor/       pdf.js, pdf-lib, fontkit, JSZip, Sortable, qrcode, fonts
server/         FastAPI app (main.py routes, convert.py, pdfops.py, einvoice.py)
Dockerfile, docker-compose.yml
```

## Not finished yet

These have no screens yet, so they are not in `web/js/registry.js`; their server endpoints
(`/api/html-to-pdf`, `/api/einvoice/*`) already exist and are tested:
Write PDF, Create job application, Create invoice (form / visual), Create electronic invoice,
PDF invoice to e-invoice, XML e-invoice to PDF, Validate e-invoice.
