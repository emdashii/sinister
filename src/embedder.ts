/** Main-thread handle on the embedding worker. The worker starts on first use. */
import type { WorkerRequest, WorkerResponse } from "./embed.worker";

export interface Progress {
  loaded: number;
  total: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(p: Progress | "ready") => void>();
let ready = false;

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    if (m.type === "progress") progressListeners.forEach((l) => l({ loaded: m.loaded, total: m.total }));
    else if (m.type === "ready") {
      ready = true;
      progressListeners.forEach((l) => l("ready"));
    } else {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "result") p.resolve(m.data);
      else p.reject(new Error(m.message));
    }
  };
  return worker;
}

export function modelReady(): boolean {
  return ready;
}

export function onModelProgress(l: (p: Progress | "ready") => void): () => void {
  progressListeners.add(l);
  return () => progressListeners.delete(l);
}

/** Embed texts; resolves to one 384-float row per text, concatenated. */
export function embed(texts: string[]): Promise<Float32Array> {
  const w = start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type: "embed", texts } satisfies WorkerRequest);
  });
}
