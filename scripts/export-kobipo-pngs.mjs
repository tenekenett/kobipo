/**
 * One-shot: rasterize Kobipo SVGs under public/assets to PNG for reliable next/image + favicons.
 * Run: node scripts/export-kobipo-pngs.mjs
 */
import sharp from "sharp"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicAssets = join(__dirname, "..", "public", "assets")

/** @type {{ inFile: string; outFile: string; width?: number; height?: number }[]} */
const jobs = [
  { inFile: "logos/kobipo-logo-yatay-acik.svg", outFile: "logos/kobipo-logo-yatay-acik.png", width: 560 },
  { inFile: "logos/kobipo-logo-yatay-koyu.svg", outFile: "logos/kobipo-logo-yatay-koyu.png", width: 560 },
  { inFile: "logos/kobipo-wordmark.svg", outFile: "logos/kobipo-wordmark.png", width: 520 },
  { inFile: "icons/kobipo-ikon-512.svg", outFile: "icons/kobipo-ikon-512.png", width: 512, height: 512 },
  { inFile: "icons/kobipo-favicon-32.svg", outFile: "icons/kobipo-favicon-32.png", width: 32, height: 32 },
  { inFile: "icons/kobipo-monokrom-siyah.svg", outFile: "icons/kobipo-monokrom-siyah.png", width: 520 },
  { inFile: "icons/kobipo-monokrom-beyaz.svg", outFile: "icons/kobipo-monokrom-beyaz.png", width: 560 },
]

for (const job of jobs) {
  const input = join(publicAssets, job.inFile)
  const output = join(publicAssets, job.outFile)
  let pipeline = sharp(input)
  if (job.width != null && job.height != null) {
    pipeline = pipeline.resize(job.width, job.height, { fit: "fill" })
  } else if (job.width != null) {
    pipeline = pipeline.resize(job.width, null, { fit: "inside" })
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(output)
  console.log("wrote", job.outFile)
}
