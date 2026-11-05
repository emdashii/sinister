/**
 * Web Worker that owns the embedding model. Loaded only when the first free-text
 * filter runs. It embeds short queries (and, for the spike's on-demand strategy, batches
 * of candidate texts) and posts Float32Arrays back.
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODEL_DTYPE, MODEL_ID } from "./engine/semantic";

export type WorkerRequest = { id: number; type: "embed"; texts: string[] };
export type WorkerResponse =
  | { id: number; type: "result"; data: Float32Array; ms: number }
  | { id: number; type: "error"; message: string }
  | { id: -1; type: "progress"; file: string; loaded: number; total: number }
  | { id: -1; type: "ready"; ms: number };

declare const ORT_VERSION: string;

env.allowLocalModels = false;
// The CPU-only runtime (14 MB) instead of the default WebGPU-capable build (27 MB).
// Both it and the model are kept in the browser's Cache Storage after the first load.
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (ort.wasm) {
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  ort.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded.mjs`, wasm: `${base}ort-wasm-simd-threaded.wasm` };
}

const post = (m: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let extractor: Promise<FeatureExtractionPipeline> | null = null;
function load(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    const t0 = performance.now();
    const sizes = new Map<string, [number, number]>();
    extractor = pipeline("feature-extraction", MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: "wasm",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.file) {
          sizes.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
          let loaded = 0;
          let total = 0;
          for (const [l, t] of sizes.values()) {
            loaded += l;
            total += t;
          }
          post({ id: -1, type: "progress", file: p.file, loaded, total });
        }
      },
    }).then((e) => {
      post({ id: -1, type: "ready", ms: performance.now() - t0 });
      return e as FeatureExtractionPipeline;
    });
  }
  return extractor;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, texts } = e.data;
  try {
    const ex = await load();
    const t0 = performance.now();
    const out = await ex(texts, { pooling: "mean", normalize: true });
    const data = out.data as Float32Array;
    post({ id, type: "result", data, ms: performance.now() - t0 }, [data.buffer]);
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
