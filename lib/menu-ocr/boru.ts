/**
 * MENÜ TARAMA BORU HATTI — dosya → sayfa parçaları → sayfa başına model çağrısı
 * → normalize. SUNUCU tarafı (sharp, unpdf, model anahtarı).
 *
 * Merdiven kısadır (plan §3.1): menüde UBL eki de karekod da yok.
 *   dijital PDF  → metin katmanı (ucuz, hatasız)
 *   taranmış PDF → sayfa raster → görsel
 *   fotoğraf     → görsel
 *
 * Sınıflandırıcı YOK: kullanıcı zaten "menü yüklüyorum" diyor. Kabul denetimi
 * (menüye benziyor mu) oturum düzeyinde `validate.ts`te.
 *
 * Her sayfa AYRI çağrıdır (sınırlı eşzamanlılık): 10 sayfalık PDF tek çağrıda
 * çıktı tavanına çarpardı; sayfa başına çağrı hem ölçülebilir hem yeniden
 * denenebilir. Sayfalar arası bölüm devri `tekillestir.ts`te.
 *
 * KAYIT YAPMAZ. Sonuç `document_scans` satırına (kind=MENU) yazılır; ürünler
 * onay ekranından `/api/stok/products`a gider.
 */

import { createHash } from "node:crypto"
import { VARSAYILAN_MODEL } from "@/lib/fis-ocr/models"
import { kullanimTopla, modeleSor, TaramaHatasi, type IcerikParcasi, type ModelKullanimi } from "@/lib/belge-ocr/saglayici"
import { gorselHazirla } from "@/lib/belge-ocr/girdi/gorsel"
import { pdfMetinOku, pdfSayfaRaster } from "@/lib/belge-ocr/girdi/pdf"
import { MENU_KOMUT, MENU_PROMPT, MENU_SEMA } from "./schema"
import { menuNormalize } from "./normalize"
import type { MenuOkuma, OkumaYolu } from "./turler"

export { TaramaHatasi }

/** Sayfa tavanı: belge taramayla aynı; tek istek 60 sn. */
export const MAX_SAYFA = 10
/** Aynı anda modele giden sayfa sayısı. */
const ESZAMANLI = 3

export type MenuBoruSonucu = {
  sha256: string
  sayfaSayisi: number
  yol: OkumaYolu
  /** Sayfa başına okuma (1. eleman = 1. sayfa) */
  sayfalar: MenuOkuma[]
  metinKarakter: number | null
  model: string
  saglayici: string
  sureMs: number
  kullanim: ModelKullanimi
}

const bosKullanim = (): ModelKullanimi => ({ girdiToken: 0, ciktiToken: 0, dusunmeToken: 0, maliyetUsd: null })

function pdfMi(dosya: Buffer, mime: string, ad: string): boolean {
  if (dosya.subarray(0, 5).toString("latin1").startsWith("%PDF")) return true
  return mime === "application/pdf" || /\.pdf$/i.test(ad)
}

/** Dosyayı modele gidecek sayfa parçalarına indirir. */
async function sayfaParcalari(dosya: Buffer, meta: { mime: string; ad: string }): Promise<{ parcalar: IcerikParcasi[]; yol: OkumaYolu; metinKarakter: number | null }> {
  if (!pdfMi(dosya, meta.mime, meta.ad)) {
    const g = await gorselHazirla(dosya)
    return { parcalar: [{ tip: "gorsel", jpeg: g.jpeg }], yol: "gorsel", metinKarakter: null }
  }
  const pdf = await pdfMetinOku(dosya)
  if (pdf.sayfaSayisi === 0) throw new TaramaHatasi("PDF'te sayfa yok")
  if (pdf.sayfaSayisi > MAX_SAYFA) {
    throw new TaramaHatasi(`PDF ${pdf.sayfaSayisi} sayfa; tek seferde en çok ${MAX_SAYFA} sayfa okunur. Dosyayı bölün.`)
  }
  if (pdf.metinKatmaniVar) {
    return {
      parcalar: pdf.metin.map((m, i) => ({ tip: "metin", metin: `--- Sayfa ${i + 1} ---\n${m}` })),
      yol: "metin",
      metinKarakter: pdf.metinKarakter,
    }
  }
  const parcalar: IcerikParcasi[] = []
  for (let n = 1; n <= pdf.sayfaSayisi; n++) {
    const jpeg = await pdfSayfaRaster(dosya, n)
    if (!jpeg) {
      throw new TaramaHatasi(
        "PDF'in metin katmanı yok ve sayfa görsele çevrilemedi (raster kütüphanesi bu ortamda yüklenemedi). Sayfayı fotoğraf/PNG olarak yükleyin."
      )
    }
    parcalar.push({ tip: "gorsel", jpeg })
  }
  return { parcalar, yol: "gorsel", metinKarakter: pdf.metinKarakter }
}

/** Sınırlı eşzamanlılıkla sıra korunarak çalıştırır. */
async function sirayla<T, R>(girdiler: T[], esz: number, fn: (g: T, i: number) => Promise<R>): Promise<R[]> {
  const sonuc: R[] = new Array(girdiler.length)
  let sonraki = 0
  const isci = async () => {
    while (sonraki < girdiler.length) {
      const i = sonraki++
      sonuc[i] = await fn(girdiler[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(esz, girdiler.length) }, isci))
  return sonuc
}

export async function menuTara(dosya: Buffer, meta: { mime: string; ad: string }, secenek: { model?: string } = {}): Promise<MenuBoruSonucu> {
  const t0 = Date.now()
  const sha256 = createHash("sha256").update(dosya).digest("hex")
  const model = secenek.model || VARSAYILAN_MODEL
  const { parcalar, yol, metinKarakter } = await sayfaParcalari(dosya, meta)

  let kullanim = bosKullanim()
  let saglayici = "—"
  const sayfalar = await sirayla(parcalar, ESZAMANLI, async (p, i) => {
    const y = await modeleSor({
      model,
      sistem: MENU_PROMPT,
      icerik: [p],
      komut: MENU_KOMUT,
      semaAdi: "menu",
      sema: MENU_SEMA,
      maxToken: 8000,
      baslik: "Kobipo menu tarama",
    })
    kullanim = kullanimTopla(kullanim, y.kullanim)
    saglayici = y.saglayici
    return menuNormalize(y.ham, i + 1)
  })

  return {
    sha256,
    sayfaSayisi: parcalar.length,
    yol,
    sayfalar,
    metinKarakter,
    model,
    saglayici,
    sureMs: Date.now() - t0,
    kullanim,
  }
}
