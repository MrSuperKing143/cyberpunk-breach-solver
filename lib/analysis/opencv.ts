interface OpenCvRuntime {
  Mat: new (...args: unknown[]) => { delete: () => void };
  MatVector: new (...args: unknown[]) => { delete: () => void; size: () => number; get: (index: number) => { delete: () => void } };
  Scalar: new (...args: number[]) => unknown;
  Rect: new (x: number, y: number, width: number, height: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  imread: (canvas: HTMLCanvasElement) => { cols: number; rows: number; roi: (rect: unknown) => unknown; delete: () => void };
  imshow: (canvas: HTMLCanvasElement, mat: unknown) => void;
  onRuntimeInitialized?: () => void;
  [key: string]: unknown;
}

type OpenCvModule = OpenCvRuntime | Promise<OpenCvRuntime>;

declare global {
  interface Window {
    cv?: OpenCvModule;
  }
}

let openCvPromise: Promise<OpenCvRuntime> | null = null;

function isReady(cv: unknown): cv is OpenCvRuntime {
  return Boolean(
    cv &&
      typeof cv === "object" &&
      "Mat" in cv &&
      typeof cv.Mat === "function" &&
      "imread" in cv &&
      typeof cv.imread === "function",
  );
}

function isPromiseLike(cv: OpenCvModule | undefined): cv is Promise<OpenCvRuntime> {
  return Boolean(
    cv &&
      typeof cv === "object" &&
      typeof (cv as Record<string, unknown>).then === "function",
  );
}

function waitForInit(runtime: OpenCvRuntime): Promise<OpenCvRuntime> {
  return new Promise<OpenCvRuntime>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("OpenCV.js timed out while initialising."));
    }, 15000);

    const previous = runtime.onRuntimeInitialized;
    runtime.onRuntimeInitialized = () => {
      window.clearTimeout(timer);
      previous?.();

      if (!isReady(runtime)) {
        reject(new Error("OpenCV.js initialised without exposing the expected runtime methods."));
        return;
      }

      resolve(runtime);
    };
  });
}

async function resolveRuntime(): Promise<OpenCvRuntime> {
  const cv = window.cv;

  if (!cv) {
    throw new Error("OpenCV.js did not attach itself to window.cv.");
  }

  if (isPromiseLike(cv)) {
    const resolved = await cv;

    if (!isReady(resolved)) {
      throw new Error("OpenCV.js resolved, but the runtime methods are unavailable.");
    }

    window.cv = resolved as unknown as typeof window.cv;
    return resolved;
  }

  return isReady(cv) ? cv : waitForInit(cv);
}

function ensureScript(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-opencv-runtime="true"]',
  );
  const el = existing ?? (() => {
    const s = document.createElement("script");
    s.src = "/vendor/opencv.js";
    s.async = true;
    s.dataset.opencvRuntime = "true";
    document.body.appendChild(s);
    return s;
  })();
  return new Promise((resolve, reject) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("OpenCV.js failed to load.")), { once: true });
  });
}

export async function loadOpenCv(): Promise<OpenCvRuntime> {
  if (openCvPromise) return openCvPromise;

  openCvPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("OpenCV.js can only load in the browser.");
    }

    if (!window.cv) await ensureScript();
    return resolveRuntime();
  })().catch((error) => {
    openCvPromise = null;
    throw error;
  });

  return openCvPromise;
}
