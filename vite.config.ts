import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";

/** The ONNX runtime version transformers.js was built against; the worker fetches its WASM from jsDelivr. */
const ORT_VERSION = (JSON.parse(readFileSync("node_modules/onnxruntime-web/package.json", "utf8")) as { version: string }).version;

/** Built files that make up the app shell (minus the model worker); everything else is cached the first time it is used. */
const SHELL = /\.(js|css|woff2|svg|png|webmanifest)$|words-[\w-]+\.json$/;

/**
 * Emit dist/sw.js. It precaches the app shell and the word list, so the letter filter
 * works offline after the first visit without downloading data the visitor has not
 * asked for. Category data, glosses, Latin names and vectors are cached on first use;
 * the model and its runtime are cached by transformers.js in Cache Storage. The cache
 * name changes whenever the worker or file list does.
 */
function offline(): Plugin {
  return {
    name: "offline-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = ["/", ...Object.keys(bundle).filter((f) => SHELL.test(f) && !f.includes("worker")).map((f) => `/${f}`), "/icon-sinister.svg", "/icon-dexter.svg", "/manifest.webmanifest"];
      const body = `const FILES = ${JSON.stringify([...new Set(files)])};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sinister-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  if (e.request.mode === "navigate") {
    // Network first, so a new deploy's HTML (and its new asset names) wins; cache when offline.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/", { ignoreVary: true })),
    );
    return;
  }
  // Hashed assets never change: cache first, and keep anything fetched for later offline use.
  e.respondWith(
    caches.match(e.request, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && new URL(e.request.url).pathname.startsWith("/assets/")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      const source = `const CACHE = "sinister-${Bun.hash(body).toString(36)}";
${body}`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/**
 * onnxruntime-web references its 27 MB WebGPU-capable WASM with `new URL(..., import.meta.url)`,
 * which makes Vite copy it into dist. The worker points the runtime at the CPU-only build
 * on jsDelivr instead, so drop the reference.
 */
function noBundledOrtWasm(): Plugin {
  return {
    name: "no-bundled-ort-wasm",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("onnxruntime-web")) return;
      return code.replace(/new URL\("(ort-wasm-simd-threaded\.asyncify\.wasm)",\s*import\.meta\.url\)/g, '"$1"');
    },
  };
}

export default defineConfig({
  plugins: [offline(), noBundledOrtWasm()],
  define: { ORT_VERSION: JSON.stringify(ORT_VERSION) },
  worker: { format: "es", plugins: () => [noBundledOrtWasm()] },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: "index.html", about: "about.html" } },
  },
});
