#!/usr/bin/env npx tsx

// Menü tarama ölçüm tezgâhı — UYGULAMANIN KENDİ modüllerini koşturur.
//
// Şema/prompt kopyası YOK: `tsx` ile lib/menu-ocr doğrudan import edilir; ölçtüğün
// prompt üretimde koşan prompt'un TA KENDİSİDİR. Bedeli: OPENROUTER_API_KEY
// (.env.local) ve sharp/unpdf'in yerelde kurulu olması.
//
//   npx tsx scripts/ai-menu-test.ts --dir ./menu-ornekleri [--model google/gemini-2.5-flash] [--kdv 10]
//
// Dizindeki TÜM dosyalar tek menü (tek oturum) sayılır: sayfa sayfa okunur,
// oturum içi tekilleştirme + denetimler çalışır, fark listesi BOŞ ürün listesine
// karşı kurulur (hepsi YENİ; KDV önerisi ve seçenek grubu türetimi görünür).
//
// Doğruluk: dizinde `dogru.json` varsa kalem kalem karşılaştırır:
//   { "kalemler": [ { "ad": "Latte", "fiyat": 90 }, { "ad": "Latte", "fiyat": 110, "etiket": "Büyük" } ] }
// Eşleşme trFold(ad) + fiyat (0,01 tolerans). Dosya yoksa yalnız çıktıyı ve GERÇEK maliyeti basar.

import "dotenv/config"
import { config as loadEnv } from "dotenv"
import fs from "node:fs"
import path from "node:path"

loadEnv({ path: ".env.local", override: false })

function argv(ad: string, varsayilan: string | null = null): string | null {
  const i = process.argv.indexOf("--" + ad)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan
}

const dizin = argv("dir", "./menu-ornekleri")!
const modelArg = argv("model")
const kdv = Number(argv("kdv", "10"))
const cikti = argv("out", "./menu-test-sonuc")!

const PARA = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toFixed(5))
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" }

function dosyalar(): string[] {
  if (!fs.existsSync(dizin)) {
    console.error(`Dizin yok: ${dizin} — menü sayfalarını koyun (jpg/png/webp/pdf). dogru.json isteğe bağlı.`)
    process.exit(1)
  }
  return fs
    .readdirSync(dizin)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .map((f) => path.join(dizin, f))
    .sort()
}

async function main() {
  const { menuTara } = await import("@/lib/menu-ocr/boru")
  const { oturumBirlestir } = await import("@/lib/menu-ocr/tekillestir")
  const { oturumDenetle, menuyeBenziyorMu } = await import("@/lib/menu-ocr/validate")
  const { farkListesiKur } = await import("@/lib/menu-ocr/eslestir")
  const { trFold } = await import("@/lib/text/tr-fold")

  fs.mkdirSync(cikti, { recursive: true })
  const liste = dosyalar()
  if (liste.length === 0) {
    console.error("Dizinde okunacak dosya yok.")
    process.exit(1)
  }

  let toplamUsd = 0
  let toplamMs = 0
  const oturum: Array<{ scanId: string; dosya: string; sayfalar: any[] }> = []
  for (const dosya of liste) {
    const buf = fs.readFileSync(dosya)
    const ad = path.basename(dosya)
    process.stdout.write(`${ad} … `)
    try {
      const r = await menuTara(buf, { mime: MIME[path.extname(dosya).toLowerCase()], ad }, { model: modelArg || undefined })
      toplamUsd += r.kullanim.maliyetUsd ?? 0
      toplamMs += r.sureMs
      const kalem = r.sayfalar.reduce((a, s) => a + s.kalemler.length, 0)
      console.log(`${r.yol} · ${r.sayfaSayisi} sayfa · ${kalem} kalem · ${(r.sureMs / 1000).toFixed(1)} sn · ${PARA(r.kullanim.maliyetUsd)} · ${r.model} (${r.saglayici})`)
      fs.writeFileSync(path.join(cikti, ad + ".json"), JSON.stringify(r, null, 2))
      oturum.push({ scanId: ad, dosya: ad, sayfalar: r.sayfalar })
    } catch (e: any) {
      console.log(`HATA: ${e?.message}`)
    }
  }

  const b = oturumBirlestir(oturum)
  console.log(`\n=== OTURUM: ${b.kalemler.length} kalem · ${b.bolumler.length} bölüm · ${b.tekrar} tekrar · ${b.fiyatsizSatir} başlık satırı · en düşük güven ${b.enDusukGuven}`)
  console.log(`Bölümler: ${b.bolumler.join(" | ") || "—"}`)
  if (b.kdvNotlari.length) console.log(`KDV notu: ${b.kdvNotlari.join(" · ")}`)
  for (const d of oturumDenetle(b)) console.log(`  [${d.durum}] ${d.etiket}: ${d.aciklama}`)

  const fark = menuyeBenziyorMu(b) ? farkListesiKur(b.kalemler, [], { oturumKdv: kdv, tamMenu: false }) : []
  console.log("\n=== KALEMLER (boş ürün listesine karşı → hepsi YENİ)")
  for (const f of fark) {
    if (f.kova !== "YENI") continue
    const fiyatlar = f.kalem.fiyatlar.map((p) => (p.etiket ? `${p.etiket} ${p.fiyat}` : String(p.fiyat))).join(" / ")
    const grup = f.oneri.secenekGrubu ? ` → ${f.oneri.secenekGrubu.ad}: ${f.oneri.secenekGrubu.secenekler.map((s) => `${s.ad}${s.priceDelta ? "+" + s.priceDelta : ""}`).join(", ")}` : ""
    const uyari = f.denetimler.filter((d) => d.durum === "patladi").map((d) => ` ⚠ ${d.aciklama}`).join("")
    console.log(`  ${(f.kalem.bolum ?? "—").padEnd(22).slice(0, 22)} ${f.kalem.ad.padEnd(34).slice(0, 34)} ${fiyatlar.padEnd(24)} %${f.oneri.kdvOrani} net ${f.oneri.net.toFixed(2)}${grup}${uyari}`)
  }

  const dogruYolu = path.join(dizin, "dogru.json")
  if (fs.existsSync(dogruYolu)) {
    const dogru = JSON.parse(fs.readFileSync(dogruYolu, "utf8")) as { kalemler: Array<{ ad: string; fiyat: number; etiket?: string }> }
    const okunan = new Map<string, number[]>()
    for (const k of b.kalemler) okunan.set(k.anahtar, k.fiyatlar.map((f) => f.fiyat))
    let dogruSayi = 0
    const kacan: string[] = []
    const yanlisFiyat: string[] = []
    for (const d of dogru.kalemler) {
      const f = okunan.get(trFold(d.ad))
      if (!f) kacan.push(`${d.ad} ${d.fiyat}`)
      else if (f.some((x) => Math.abs(x - d.fiyat) < 0.01)) dogruSayi++
      else yanlisFiyat.push(`${d.ad}: beklenen ${d.fiyat}, okunan ${f.join("/")}`)
    }
    const dogruAnahtarlar = new Set(dogru.kalemler.map((d) => trFold(d.ad)))
    const fazla = b.kalemler.filter((k) => !dogruAnahtarlar.has(k.anahtar)).map((k) => k.ad)
    console.log(`\n=== DOĞRULUK: ${dogruSayi}/${dogru.kalemler.length} kalem+fiyat doğru · ${kacan.length} kaçan · ${yanlisFiyat.length} yanlış fiyat · ${fazla.length} fazladan`)
    for (const k of kacan) console.log(`  kaçan: ${k}`)
    for (const y of yanlisFiyat) console.log(`  fiyat: ${y}`)
    for (const f of fazla) console.log(`  fazla: ${f}`)
  }

  console.log(`\nToplam: ${liste.length} dosya · ${(toplamMs / 1000).toFixed(1)} sn · ${PARA(toplamUsd)} · çıktı: ${cikti}/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
