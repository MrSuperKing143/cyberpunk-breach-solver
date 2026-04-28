import { BREACH_CODES, type BreachCode, type CodeValue } from "@/lib/types/breach";

type TesseractModule = typeof import("tesseract.js");
type OcrWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>;

let ocrWorkerPromise: Promise<OcrWorker> | null = null;

const confusionGroups = [
  "1IL|",
  "5S",
  "7T",
  "A4",
  "B8",
  "CD0OQ",
  "EF",
  "9GQ",
];

function sameGroup(left: string, right: string) {
  return confusionGroups.some((group) => group.includes(left) && group.includes(right));
}

function cleanRawToken(rawText: string) {
  return rawText.toUpperCase().replace(/[^A-Z0-9|]/g, "");
}

function scoreCandidate(rawText: string, candidate: BreachCode) {
  const padded = rawText.padEnd(candidate.length, " ");
  let score = 0;

  for (let index = 0; index < candidate.length; index += 1) {
    const actual = padded[index] ?? " ";
    const expected = candidate[index];

    if (actual === expected) {
      score += 3;
      continue;
    }

    if (sameGroup(actual, expected)) {
      score += 1;
      continue;
    }

    score -= 2;
  }

  score -= Math.abs(rawText.length - candidate.length);
  return score;
}

function normalizeToCode(rawText: string, baseConfidence: number): {
  value: CodeValue;
  confidence: number;
  rawText: string;
} {
  const cleaned = cleanRawToken(rawText);

  if (BREACH_CODES.includes(cleaned as BreachCode)) {
    return {
      value: cleaned as BreachCode,
      confidence: Math.max(Math.min(baseConfidence, 1), 0),
      rawText: cleaned,
    };
  }

  let bestCode: CodeValue = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of BREACH_CODES) {
    const score = scoreCandidate(cleaned, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCode = candidate;
    }
  }

  if (!bestCode || bestScore < 0) {
    return {
      value: "",
      confidence: Math.max(baseConfidence * 0.35, 0),
      rawText: cleaned,
    };
  }

  const fuzzyConfidence = Math.max(Math.min(bestScore / 6, 1), 0);
  return {
    value: bestCode,
    confidence: Math.max(Math.min(baseConfidence * 0.7 + fuzzyConfidence * 0.3, 1), 0),
    rawText: cleaned,
  };
}

async function getWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(async (module) => {
      const worker = await module.createWorker("eng");
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "1234567890ABCDEFILS|",
      });
      return worker;
    });
  }

  return ocrWorkerPromise;
}

export async function recognizeCodeToken(canvas: HTMLCanvasElement) {
  const worker = await getWorker();
  const tesseract = await import("tesseract.js");

  await worker.setParameters({
    tessedit_pageseg_mode: tesseract.PSM.SINGLE_WORD,
  });

  const {
    data: { text, confidence },
  } = await worker.recognize(canvas);

  return normalizeToCode(text, Math.max(confidence / 100, 0));
}
