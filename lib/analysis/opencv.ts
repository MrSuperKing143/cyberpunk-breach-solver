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

function isReadyRuntime(runtime: unknown): runtime is OpenCvRuntime {
  return Boolean(
    runtime &&
      typeof runtime === "object" &&
      "Mat" in runtime &&
      typeof runtime.Mat === "function" &&
      "imread" in runtime &&
      typeof runtime.imread === "function",
  );
}

function isPromiseLikeRuntime(runtime: OpenCvModule | undefined): runtime is Promise<OpenCvRuntime> {
  return Boolean(runtime && typeof runtime === "object" && "then" in runtime);
}

function waitForCallbackRuntime(runtime: OpenCvRuntime) {
  return new Promise<OpenCvRuntime>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("OpenCV.js timed out while initialising."));
    }, 15000);

    const previous = runtime.onRuntimeInitialized;
    runtime.onRuntimeInitialized = () => {
      window.clearTimeout(timeout);
      previous?.();

      if (!isReadyRuntime(runtime)) {
        reject(new Error("OpenCV.js initialised without exposing the expected runtime methods."));
        return;
      }

      resolve(runtime);
    };
  });
}

async function resolveRuntime() {
  const runtime = window.cv;

  if (!runtime) {
    throw new Error("OpenCV.js did not attach itself to window.cv.");
  }

  if (isPromiseLikeRuntime(runtime)) {
    const resolved = await runtime;

    if (!isReadyRuntime(resolved)) {
      throw new Error("OpenCV.js resolved, but the runtime methods are unavailable.");
    }

    window.cv = resolved as unknown as typeof window.cv;
    return resolved;
  }

  if (isReadyRuntime(runtime)) {
    return runtime;
  }

  return waitForCallbackRuntime(runtime);
}

export async function loadOpenCv() {
  if (!openCvPromise) {
    openCvPromise = new Promise<OpenCvRuntime>((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("OpenCV.js can only load in the browser."));
        return;
      }

      if (window.cv) {
        void resolveRuntime().then(resolve).catch(reject);
        return;
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-opencv-runtime="true"]',
      );

      if (existingScript) {
        existingScript.addEventListener(
          "load",
          () => {
            void resolveRuntime().then(resolve).catch(reject);
          },
          { once: true },
        );
        existingScript.addEventListener(
          "error",
          () => reject(new Error("OpenCV.js failed to load.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = "/vendor/opencv.js";
      script.async = true;
      script.dataset.opencvRuntime = "true";
      script.addEventListener(
        "load",
        () => {
          void resolveRuntime().then(resolve).catch(reject);
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => reject(new Error("OpenCV.js failed to load.")),
        { once: true },
      );
      document.body.appendChild(script);
    }).catch((error) => {
      openCvPromise = null;
      throw error;
    });
  }

  return openCvPromise;
}
