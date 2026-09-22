export interface ExtractedPdfText {
  readonly text: string;
  readonly pageCount: number;
  readonly textPageCount: number;
}

export async function extractPdfTextLocally(
  bytes: ArrayBuffer,
): Promise<ExtractedPdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (pdfjs.GlobalWorkerOptions.workerSrc.length === 0) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const document = await task.promise;
  const pages: string[] = [];
  let textPageCount = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) {
          continue;
        }
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const lineKey = Math.round(y * 2) / 2;
        const line = lines.get(lineKey) ?? [];
        line.push({ x, text: item.str.trim() });
        lines.set(lineKey, line);
      }
      const text = [...lines.entries()]
        .toSorted(([left], [right]) => right - left)
        .map(([, line]) =>
          line
            .toSorted((left, right) => left.x - right.x)
            .map((item) => item.text)
            .join(" "),
        )
        .join("\n")
        .trim();
      if (text.length >= 20) {
        textPageCount += 1;
      }
      pages.push(text);
    }
  } finally {
    await document.destroy();
  }
  return {
    text: pages.join("\n\f\n"),
    pageCount: pages.length,
    textPageCount,
  };
}
