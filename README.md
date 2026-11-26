# Folio

Folio is a local-first Progressive Web App that turns PDFs into interactive books. Import a PDF from the library, pick up at the last saved page, or try the included sample documents. Folio runs entirely in the browser and requires no accounts, backend, or API credentials.

## Development

Use Node.js 24 LTS and npm. The lockfile pins the dependency graph.

```sh
npm ci
npm run dev
```

Vite prints the development address. For an offline-capable local build, use the production preview. Vite's development server does not register the production service worker.

```sh
npm run build
npm run preview
```

After the first production visit, allow the service worker to finish caching before going offline. Install through Settings or the browser's install command. In Safari on iPhone or iPad, use Share → Add to Home Screen. Folio offers an update when an updated service worker is ready.

## Reading

- Use the arrow buttons or arrow keys to turn pages. Home and End jump to the boundaries. Drag an outer corner to curl the page, or tap an edge or swipe on a touch screen. Pinch to zoom. Reader options include automatic, single-page, double-page, and scrolling layouts.
- On a phone with motion sensors, enable **Turn pages by tilting** in **Reader options** and allow motion access if prompted. Hold the phone in your reading position. Tilt left or right while the menu is open to check detection. Close the menu, tilt left to advance or right to go back, then return to center. Use HTTPS when opening Folio on your phone.
- Enter a page number in the footer and press Enter. Use the pages sidebar for thumbnails or Reader options for the embedded PDF outline. The search panel indexes the full PDF and marks matching passages in the reader.
- Bookmark a page from the footer or annotations panel. Create or edit page notes in that panel. To highlight text, select a passage inside one page, then choose **Highlight selection** under Reader options.
- Use the sun or moon in the library toolbar to switch app appearance. The palette button in the reader previews the separate reading themes. Original preserves the PDF's appearance. Light, Sepia, and Dark apply reversible visual filters. Image-only PDFs remain readable but require an existing OCR text layer for selectable text, highlighting, and search. Password-protected uploads retain the original encrypted bytes. Folio asks for the password when they are reopened.
- Use the book menu to rename, move, or delete documents. The heart toggles favorites. Collections are created from the sidebar or Collections screen. Settings reports browser storage usage and can request that the browser retain local data. Browser settings, private mode, quotas, and changes to the app's origin can affect access to a local library.
- Choose **Export HTML flipbook** in Reader options to download a single file that opens offline in a browser. The export embeds rendered page images with navigation. Searchable text, bookmarks, and personal notes stay in Folio. Exports from password-protected PDFs contain unencrypted page images.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/App.tsx` | Library navigation, import flow, book management, PWA controls |
| `src/components/Reader.tsx` | Reading controls, search, outline, annotations, scroll mode |
| `src/components/PdfPage.tsx` | PDF.js canvas and selectable text layer, bounded thumbnail cache |
| `src/components/FlipBook.tsx`, `src/lib/flip.ts` | HTML page-turn renderer, gesture handling, spread navigation |
| `src/lib/pdf.ts` | PDF.js worker configuration, validation, password flow, metadata and outline |
| `src/lib/export.ts` | On-demand rendering and standalone HTML packaging |
| `src/lib/storage.ts`, `src/lib/model.ts` | IndexedDB schema, transactions, and domain types |
| `src/lib/store.ts` | Zustand library state backed by IndexedDB |
| `vite.config.ts` | Vite, Tailwind, Workbox precache, manifest, local PDF.js assets |

IndexedDB uses separate stores for the original file blobs, book metadata and annotations, collections, and preferences. Import validates the PDF header and parser result before committing the file and record in one transaction. User-supplied strings are rendered as text by React. Folio does not run PDF scripting or fetch resources from a document's external links.

The reader loads on demand. The PDF.js worker parses the document while the canvas renderer draws the visible page or spread with capped backing-store resolution. Movement primes nearby page descriptors. The transition draws only the turning surfaces and destination. The page and thumbnail renderers cancel obsolete jobs and release canvases on unmount or resize. Scroll mode mounts canvases only near the current page. Full-document search indexes text incrementally.

Workbox precaches the application shell, static assets, PDF worker, fonts, and sample books. The cached application shell serves as the offline navigation fallback. Uploaded PDFs and their reading state are always read from IndexedDB.

## Tests

```sh
npm test
npx playwright install chromium
npm run build
npm run test:e2e
```

Set `FOLIO_CHROMIUM` to use a system Chromium executable. Playwright starts the built application on port 4173. Browser coverage includes library organization, page turns, document search, notes, corrupt and password-protected PDFs, image-only PDFs, mobile touch gestures, Chromium installability, offline reopening of a 205-page mixed-orientation document, and portable export. Test documents are synthetic. The protected fixture uses the password `folio-test`.

## Deployment

Run `npm ci` and `npm run build`, then publish the contents of `dist/` to the root of a static HTTPS site. Preserve all files, including `sw.js`, its Workbox bundle, the manifest, and the local `pdf/` assets. Serve `sw.js` and `index.html` with revalidation enabled. Content-hashed assets can use long-lived caching. Serve `.mjs` files with a JavaScript MIME type and `.wasm` with `application/wasm`. Serve over HTTPS in production so the app can install and cache offline.

The included sample PDFs can be regenerated with `node scripts/generate-samples.mjs`.
