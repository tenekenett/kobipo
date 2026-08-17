import fs from "node:fs"
import path from "node:path"
import { FONT } from "./theme"

/**
 * Türkçe karakterli Unicode font (DejaVu Sans) dosya yolları.
 *
 * pdfmake Node tarafında fontu DOSYA YOLUNDAN gömer (tarayıcıdaki vfs'e gerek
 * yok). İki kaynak denenir: önce `dejavu-fonts-ttf` paketi (gerçek bağımlılık),
 * yoksa `public/fonts`. İkisi de Vercel fonksiyon paketine `next.config.js >
 * outputFileTracingIncludes` ile dahil edilir — fs ile okunan dosyaları Next'in
 * izleyicisi kendiliğinden görmez.
 */

const CANDIDATE_DIRS = [
  () => path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf"),
  () => path.join(process.cwd(), "public", "fonts"),
]

function resolveFont(file: string, fallback?: string): string {
  for (const dir of CANDIDATE_DIRS) {
    const p = path.join(dir(), file)
    if (fs.existsSync(p)) return p
  }
  if (fallback) return resolveFont(fallback)
  throw new Error(`PDF fontu bulunamadı: ${file}`)
}

/** pdfmake her ağırlık için dosya ister; eğik yoksa düz/kalın karşılığa düşeriz. */
export function pdfFonts() {
  return {
    [FONT]: {
      normal: resolveFont("DejaVuSans.ttf"),
      bold: resolveFont("DejaVuSans-Bold.ttf"),
      italics: resolveFont("DejaVuSans-Oblique.ttf", "DejaVuSans.ttf"),
      bolditalics: resolveFont("DejaVuSans-BoldOblique.ttf", "DejaVuSans-Bold.ttf"),
    },
  }
}
