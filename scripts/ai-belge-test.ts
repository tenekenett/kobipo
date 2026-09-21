#!/usr/bin/env npx tsx

// Belge tarama ölçüm tezgâhı — UYGULAMANIN KENDİ modüllerini koşturur.
//
// Fiş tezgâhından (scripts/ai-fis-test.mjs) farkı: şema/prompt kopyası YOK.
// `tsx` ile lib/belge-ocr ve lib/fis-ocr doğrudan import edilir; ölçtüğün
// prompt üretimde koşan prompt'un TA KENDİSİDİR. Bedeli: OPENROUTER_API_KEY
// (.env.local) ve sharp/unpdf'in yerelde kurulu olması.
//
//   npx tsx scripts/ai-belge-test.ts --tur fis   --dir ./fis-ornekleri
//   npx tsx scripts/ai-belge-test.ts --tur boru  --dir ./belge-ornekleri --vkn 7352344835 --unvan "REYPO BİLİŞİM"
//   npx tsx scripts/ai-belge-test.ts --tur sinif --dir ./belge-ornekleri --vkn ... [--model google/gemini-3.5-flash-lite]
//
// --tur fis   : lib/fis-ocr/extract.ts → fisTara (taşıma sonrası ölçüm eşitliği)
// --tur sinif : yalnız sınıflandırıcı (tür + yön); model karşılaştırması için --model
// --tur boru  : tam boru hattı (sınıf + tür çıkarımı + denetim) — fatura/irsaliye/dekont/çek
//
// Doğruluk: dosyanın yanında <isim>.dogru.json varsa alan alan karşılaştırır.
//   fiş   → ai-fis-test.mjs ile aynı biçim (saticiUnvan, vknTckn, tarih, genelToplam, kdvToplam, kalemler[])
//   boru  → { belgeler: [{ tur, yon, belgeNo, tarih, toplam, vkn, kalemSayisi }] }
// Dosya yoksa yalnız çıktıyı ve GERÇEK maliyeti basar.

import "dotenv/config"
import { config as loadEnv } from "dotenv"
import fs from "node:fs"
import path from "node:path"

loadEnv({ path: ".env.local", override: false })

function argv(ad: string, varsayilan: string | null = null): string | null {
  const i = process.argv.indexOf("--" + ad)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan
}

const tur = argv("tur", "boru")!
const dizin = argv("dir", "./belge-ornekleri")!
const modelArg = argv("model")
const cikti = argv("out", "./belge-test-sonuc")!
const firma = { vkn: argv("vkn"), unvan: argv("unvan") }

const PARA = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toFixed(5))
const say = (s: unknown, n: number) => String(s ?? "").padEnd(n).slice(0, n)

const TR_KATLA: Record<string, string> = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c", â: "a", î: "i", û: "u" }
const sade = (s: unknown) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[ğüşıöçâîû]/g, (h) => TR_KATLA[h])
    .replace(/[^a-z0-9]/g, "")
const sayiEsit = (a: unknown, b: unknown) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01
const dogruYolu = (dosya: string) => dosya.replace(/\.[^.]+$/, ".dogru.json")
const dogruOku = (dosya: string): any | null =>
  fs.existsSync(dogruYolu(dosya)) ? JSON.parse(fs.readFileSync(dogruYolu(dosya), "utf8")) : null

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".xml": "text/xml" }

function dosyalar(): string[] {
  if (!fs.existsSync(dizin)) {
    console.error(`Dizin yok: ${dizin} — örnekleri koyun (jpg/png/pdf/xml). .dogru.json isteğe bağlı.`)
    process.exit(1)
  }
  return fs
    .readdirSync(dizin)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .map((f) => path.join(dizin, f))
    .sort()
}

// --------------------------------------------------------------------- fiş
async function fisTezgahi() {
  const { fisTara } = await import("@/lib/fis-ocr/extract")
  const { denetle } = await import("@/lib/fis-ocr/validate")
  fs.mkdirSync(cikti, { recursive: true })
  let toplamUsd = 0
  const satirlar: string[] = []
  for (const dosya of dosyalar()) {
    const buf = fs.readFileSync(dosya)
    const r = await fisTara(buf, { model: modelArg || undefined })
    toplamUsd += r.kullanim.maliyetUsd ?? 0
    const dogru = dogruOku(dosya)
    fs.writeFileSync(path.join(cikti, path.basename(dosya) + ".json"), JSON.stringify(r, null, 2))
    for (const [i, fis] of r.fisler.entries()) {
      const d = denetle(fis)
      const patlayan = d.filter((x) => x.durum === "patladi").map((x) => x.anahtar)
      let dogruluk = "—"
      if (dogru) {
        const liste = Array.isArray(dogru) ? dogru : dogru.fisler ?? [dogru]
        const vkn = String(fis.vknTckn ?? "").replace(/\D/g, "")
        const es = liste.find((x: any) => String(x.vknTckn ?? "").replace(/\D/g, "") === vkn) ?? liste.find((x: any) => sayiEsit(x.genelToplam, fis.genelToplam))
        if (es) {
          const kontrol = [
            [es.saticiUnvan, ...(es.saticiUnvanAlt ?? [])].some((u: string) => sade(u) === sade(fis.saticiUnvan)),
            sade(es.vknTckn) === sade(fis.vknTckn),
            String(es.tarih ?? "").slice(0, 10) === String(fis.tarih ?? "").slice(0, 10),
            sayiEsit(es.genelToplam, fis.genelToplam),
            sayiEsit(es.kdvToplam, fis.kdvToplam),
            (es.kalemler?.length ?? 0) === (fis.kalemler?.length ?? 0),
          ]
          const cikanAd = new Set((fis.kalemler ?? []).map((k) => sade(k.ad)))
          const dogruAd = new Set<string>((es.kalemler ?? []).map((k: any) => sade(k.ad)))
          const kesisim = [...dogruAd].filter((a) => cikanAd.has(a)).length
          const kalemOran = dogruAd.size ? kesisim / dogruAd.size : 1
          const gecen = kontrol.filter(Boolean).length
          dogruluk = Math.round(((gecen / kontrol.length) * 0.6 + kalemOran * 0.4) * 100) + "%"
        } else dogruluk = "eşleşmedi"
      }
      satirlar.push(
        `${say(path.basename(dosya), 24)} #${i + 1} ${say(fis.saticiUnvan, 22)} ${say(fis.vknTckn, 12)} ${say(fis.tarih, 11)} ${say(fis.genelToplam, 9)} kdv ${say(fis.kdvToplam, 8)} kalem ${say(fis.kalemler.length, 3)} ${say(fis.odeme?.sekil, 12)} doğruluk ${say(dogruluk, 9)} patlayan ${patlayan.join(",") || "-"}`
      )
    }
    satirlar.push(`   ↳ ${r.model} · ${r.saglayici} · ${(r.sureMs / 1000).toFixed(1)} sn · ${PARA(r.kullanim.maliyetUsd)} · ${r.gorsel.genislik}×${r.gorsel.yukseklik}`)
  }
  console.log(satirlar.join("\n"))
  console.log(`\nToplam ${PARA(toplamUsd)} — çıktı: ${cikti}/`)
}

// ------------------------------------------------------------- sınıf / boru
async function boruTezgahi(yalnizSinif: boolean) {
  const { belgeTara } = await import("@/lib/belge-ocr/boru")
  const { modeleSor } = await import("@/lib/belge-ocr/saglayici")
  const { SINIF_KOMUT, SINIF_PROMPT, SINIF_SEMA } = await import("@/lib/belge-ocr/sinif/schema")
  const { sinifNormalize } = await import("@/lib/belge-ocr/sinif/normalize")
  const { gorselHazirla } = await import("@/lib/belge-ocr/girdi/gorsel")
  const { pdfOku, pdfSayfaRaster } = await import("@/lib/belge-ocr/girdi/pdf")
  fs.mkdirSync(cikti, { recursive: true })
  if (!firma.vkn) console.warn("UYARI: --vkn verilmedi; yön hep BELİRSİZ çıkar.")

  let toplamUsd = 0
  let dogruSayac = { belge: 0, tur: 0, yon: 0, no: 0, tarih: 0, toplam: 0, vkn: 0, kalem: 0 }
  for (const dosya of dosyalar()) {
    const buf = fs.readFileSync(dosya)
    const mime = MIME[path.extname(dosya).toLowerCase()]
    const dogru = dogruOku(dosya)
    const t0 = Date.now()
    let sinif: any[]
    let belgeler: any[] = []
    let olcum: { model: string; saglayici: string; kullanim: any; yol: string; sayfa: number }
    if (yalnizSinif) {
      // Yalnız geçiş A: içerik hazırlığı boru hattındakiyle aynı (görsel/metin).
      const parcalar: any[] = []
      let sayfa = 1
      if (mime === "application/pdf") {
        const p = await pdfOku(buf)
        sayfa = p.sayfaSayisi
        if (p.metinKatmaniVar) p.metin.forEach((m, i) => parcalar.push({ tip: "metin", metin: `--- Sayfa ${i + 1} ---\n${m}` }))
        else for (let n = 1; n <= p.sayfaSayisi; n++) parcalar.push({ tip: "gorsel", jpeg: await pdfSayfaRaster(buf, n) })
      } else parcalar.push({ tip: "gorsel", jpeg: (await gorselHazirla(buf)).jpeg })
      const model = modelArg || process.env.BELGE_SINIF_MODEL || (await import("@/lib/fis-ocr/models")).VARSAYILAN_MODEL
      const y = await modeleSor({ model, sistem: SINIF_PROMPT, icerik: parcalar, komut: SINIF_KOMUT, semaAdi: "sinif", sema: SINIF_SEMA })
      sinif = sinifNormalize(y.ham, firma)
      olcum = { model, saglayici: y.saglayici, kullanim: y.kullanim, yol: parcalar[0]?.tip ?? "?", sayfa }
    } else {
      const r = await belgeTara(buf, { mime, ad: path.basename(dosya) }, { firma, bizimIbanlar: [], model: modelArg || undefined })
      sinif = r.belgeler.map((b) => b.sinif)
      belgeler = r.belgeler
      olcum = { model: r.model, saglayici: r.saglayici, kullanim: r.kullanim, yol: r.yol, sayfa: r.sayfaSayisi }
      fs.writeFileSync(path.join(cikti, path.basename(dosya) + ".json"), JSON.stringify(r, (k, v) => (k === "jpeg" ? "<buffer>" : v), 2))
    }
    toplamUsd += olcum.kullanim.maliyetUsd ?? 0
    console.log(`\n${path.basename(dosya)}  [${olcum.yol}, ${olcum.sayfa} sayfa]  ${olcum.model} · ${olcum.saglayici} · ${((Date.now() - t0) / 1000).toFixed(1)} sn · ${PARA(olcum.kullanim.maliyetUsd)}`)
    for (const [i, s] of sinif.entries()) {
      const d = dogru?.belgeler?.[i]
      const b = belgeler[i]
      const patlayan = b?.denetimler?.filter((x: any) => x.durum === "patladi").map((x: any) => x.anahtar) ?? []
      const kalem = b?.veri?.kalemler?.length
      let isaret = ""
      if (d) {
        dogruSayac.belge++
        const t = d.tur === s.tur
        const yn = !d.yon || d.yon === s.yon
        const no = d.belgeNo == null || sade(d.belgeNo) === sade(s.belgeNo)
        const tr = d.tarih == null || d.tarih === s.tarih
        const tp = d.toplam == null || sayiEsit(d.toplam, s.toplam)
        const vk = d.vkn == null || d.vkn === s.duzenleyenVknTckn || d.vkn === s.muhatapVknTckn
        const kl = d.kalemSayisi == null || d.kalemSayisi === kalem
        if (t) dogruSayac.tur++
        if (yn) dogruSayac.yon++
        if (no) dogruSayac.no++
        if (tr) dogruSayac.tarih++
        if (tp) dogruSayac.toplam++
        if (vk) dogruSayac.vkn++
        if (kl) dogruSayac.kalem++
        isaret = `  doğru: tür${t ? "✓" : "✗"} yön${yn ? "✓" : "✗"} no${no ? "✓" : "✗"} tarih${tr ? "✓" : "✗"} toplam${tp ? "✓" : "✗"} vkn${vk ? "✓" : "✗"} kalem${kl ? "✓" : "✗"}`
      }
      console.log(
        `  ${i + 1}. ${say(s.tur, 9)} ${say(s.yon, 9)}(${s.yonDayanagi}) s${s.sayfalar.join(",")} ${say(s.duzenleyenUnvan, 24)} ${say(s.duzenleyenVknTckn, 11)} → ${say(s.muhatapUnvan, 20)} ${say(s.muhatapVknTckn, 11)} no ${say(s.belgeNo, 18)} ${say(s.tarih, 10)} ${say(s.toplam, 10)} güven ${s.guven.toFixed(2)}${kalem != null ? ` kalem ${kalem}` : ""}${patlayan.length ? ` PATLAYAN ${patlayan.join(",")}` : ""}${isaret}${s.not ? `  (${s.not})` : ""}`
      )
    }
  }
  console.log(`\nToplam ${PARA(toplamUsd)}${yalnizSinif ? "" : ` — çıktı: ${cikti}/`}`)
  if (dogruSayac.belge > 0) {
    const y = (n: number) => Math.round((n / dogruSayac.belge) * 100) + "%"
    console.log(`Doğruluk (${dogruSayac.belge} belge): tür ${y(dogruSayac.tur)} · yön ${y(dogruSayac.yon)} · no ${y(dogruSayac.no)} · tarih ${y(dogruSayac.tarih)} · toplam ${y(dogruSayac.toplam)} · vkn ${y(dogruSayac.vkn)} · kalem ${y(dogruSayac.kalem)}`)
  }
}

;(async () => {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY yok (.env.local)")
    process.exit(1)
  }
  if (tur === "fis") await fisTezgahi()
  else if (tur === "sinif") await boruTezgahi(true)
  else if (tur === "boru") await boruTezgahi(false)
  else {
    console.error("--tur fis | sinif | boru")
    process.exit(1)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
