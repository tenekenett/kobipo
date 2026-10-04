/**
 * MALİ TABLOLAR — mizandan Tekdüzen bilanço ve gelir tablosu. Saf modül.
 *
 * Plan §4. Rakamlar YALNIZ onaylı fişlerden (mizan) gelir; bugünkü "kaynaklardan
 * kurulan" bilanço (lib/raporlar/bilanco.ts) ile yan yana durur, muhasebe defteri
 * olan firma bunu kullanır.
 *
 * Bilanço:
 *   - Hesap bakiyesi kendi normal yönüyle yazılır; düzenleyici (-) hesap grubunda eksi.
 *   - Cari alt hesapları TERS bakiyede yeniden sınıflanır (cari başına, bugünkü
 *     bilanço ile aynı ilke): alacak bakiyeli müşteri → 340 Alınan Sipariş Avansları,
 *     borç bakiyeli tedarikçi → 159 Verilen Sipariş Avansları, borç bakiyeli personel
 *     hesabı (335) → 135 Personelden Alacaklar.
 *   - Kapanış yapılmamışsa 6 ve 7. sınıfların net sonucu öz kaynaklarda "Dönem Net
 *     Kârı (Zararı) — kapanmamış" satırıdır; bilanço böyle denkleşir.
 *
 * Gelir tablosu (7/A): gider hesapları yıl içinde 7. sınıfta birikir; yansıtma
 * yapılmadan 7xx grubunun neti karşılık geldiği 6xx satırına okunur (770 → 632 …).
 * Yansıtmadan sonra 7xx grubu sıfırlanır, 6xx dolu gelir — iki kez sayılmaz.
 */

import { r2 } from "@/lib/muhasebe/fis"
import { tekduzenHesabi } from "@/lib/muhasebe/tekduzen"
import type { MizanSatiri } from "@/lib/muhasebe/mizan"

export type TabloSatiri = { kod: string; ad: string; tutar: number }
export type TabloGrubu = { kod: string; ad: string; tutar: number; satirlar: TabloSatiri[] }
export type TabloBolumu = { kod: string; ad: string; tutar: number; gruplar: TabloGrubu[] }

export type Bilanco = {
  aktif: TabloBolumu[]
  pasif: TabloBolumu[]
  aktifToplam: number
  pasifToplam: number
  /** Kapanmamış dönem sonucu (6 + 7. sınıf neti, + kâr). */
  kapanmamisSonuc: number
  /** Ters bakiyeden yeniden sınıflanan tutarlar (bilgi). */
  yenidenSiniflanan: Array<{ kaynak: string; hedef: string; tutar: number }>
}

const BOLUM_ADI: Record<string, string> = {
  "1": "Dönen Varlıklar",
  "2": "Duran Varlıklar",
  "3": "Kısa Vadeli Yabancı Kaynaklar",
  "4": "Uzun Vadeli Yabancı Kaynaklar",
  "5": "Öz Kaynaklar",
}

/** Mizandaki net bakiye (borç − alacak). */
const net = (s: Pick<MizanSatiri, "bakiyeBorc" | "bakiyeAlacak">) => r2(s.bakiyeBorc - s.bakiyeAlacak)

/** Kebir hesabının bilançodaki tutarı: aktifte borç − alacak, pasifte alacak − borç. */
function tablodaTutar(kod: string, borcEksiAlacak: number): number {
  const sinif = kod[0]
  return sinif === "1" || sinif === "2" ? borcEksiAlacak : -borcEksiAlacak
}

const ADLAR: Record<string, string> = {
  "340": "Alınan Sipariş Avansları",
  "159": "Verilen Sipariş Avansları",
  "135": "Personelden Alacaklar",
}

export function bilancoKur(satirlar: MizanSatiri[]): Bilanco {
  const kebir = new Map<string, number>() // kod → borç − alacak
  const yenidenSiniflanan: Bilanco["yenidenSiniflanan"] = []
  const ekle = (kod: string, v: number) => kebir.set(kod, r2((kebir.get(kod) ?? 0) + v))

  // Alt hesaplı kebirler alt hesap bazında sınıflanır (cari başına ters bakiye).
  const kodlar = satirlar.map((s) => s.kod)
  const yaprakMi = (kod: string) => !kodlar.some((k) => k.startsWith(`${kod}.`))
  const altlar = satirlar.filter((s) => s.duzey >= 4 && yaprakMi(s.kod))
  const altKebirleri = new Set(altlar.map((s) => s.kod.split(".")[0]))
  for (const s of altlar) {
    const k = s.kod.split(".")[0]
    const v = net(s)
    if (k === "120" && v < 0) {
      ekle("340", v)
      yenidenSiniflanan.push({ kaynak: s.kod, hedef: "340", tutar: -v })
    } else if (k === "320" && v > 0) {
      ekle("159", v)
      yenidenSiniflanan.push({ kaynak: s.kod, hedef: "159", tutar: v })
    } else if (k === "335" && v > 0) {
      ekle("135", v)
      yenidenSiniflanan.push({ kaynak: s.kod, hedef: "135", tutar: v })
    } else {
      ekle(k, v)
    }
  }
  for (const s of satirlar) {
    if (s.duzey !== 3 || altKebirleri.has(s.kod)) continue
    ekle(s.kod, net(s))
  }

  // 6 + 7. sınıf ve 69 grubu: kapanmamış dönem sonucu (kâr = alacak fazlası).
  let sonuc = 0
  for (const [kod, v] of kebir) if (kod[0] === "6" || kod[0] === "7") sonuc = r2(sonuc - v)

  const bolum = (sinif: string): TabloBolumu => {
    const gruplar = new Map<string, TabloGrubu>()
    for (const [kod, v] of [...kebir].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (kod[0] !== sinif || r2(v) === 0) continue
      const grupKod = kod.slice(0, 2)
      const g = gruplar.get(grupKod) ?? { kod: grupKod, ad: tekduzenHesabi(grupKod)?.ad ?? grupKod, tutar: 0, satirlar: [] }
      const tutar = tablodaTutar(kod, v)
      g.satirlar.push({ kod, ad: ADLAR[kod] ?? tekduzenHesabi(kod)?.ad ?? kod, tutar })
      g.tutar = r2(g.tutar + tutar)
      gruplar.set(grupKod, g)
    }
    if (sinif === "5" && sonuc !== 0) {
      const g = gruplar.get("59") ?? { kod: "59", ad: tekduzenHesabi("59")?.ad ?? "Dönem Net Kârı (Zararı)", tutar: 0, satirlar: [] }
      g.satirlar.push({ kod: "—", ad: sonuc >= 0 ? "Dönem Net Kârı (kapanmamış)" : "Dönem Net Zararı (kapanmamış)", tutar: sonuc })
      g.tutar = r2(g.tutar + sonuc)
      gruplar.set("59", g)
    }
    const liste = [...gruplar.values()].sort((a, b) => a.kod.localeCompare(b.kod))
    return { kod: sinif, ad: BOLUM_ADI[sinif], tutar: r2(liste.reduce((a, g) => a + g.tutar, 0)), gruplar: liste }
  }

  const aktif = ["1", "2"].map(bolum)
  const pasif = ["3", "4", "5"].map(bolum)
  return {
    aktif,
    pasif,
    aktifToplam: r2(aktif.reduce((a, b) => a + b.tutar, 0)),
    pasifToplam: r2(pasif.reduce((a, b) => a + b.tutar, 0)),
    kapanmamisSonuc: sonuc,
    yenidenSiniflanan,
  }
}

// ── Gelir tablosu ────────────────────────────────────────────────────────────

/** 7/A gider hesabının yansıdığı 6. sınıf hesabı. */
export function yansimaHesabi(kebirKod: string): string | null {
  const g = kebirKod.slice(0, 2)
  if (g === "71" || g === "72" || g === "73") return "620"
  if (g === "74") return "622"
  if (g === "75") return "630"
  if (g === "76") return "631"
  if (g === "77") return "632"
  if (g === "78") return "660"
  return null
}

export type GelirTablosuKalemi = { kod: string; ad: string; tutar: number; ara?: boolean; satirlar?: TabloSatiri[] }

/**
 * Dönem içi hareketlerden (mizanın DÖNEM sütunları) gelir tablosu. Kapanış fişleri
 * (6 → 690) hareket olarak sayılırsa tablo sıfırlanırdı: `kapanisHaric` dönem
 * hareketinden kapanış fişlerinin payını düşmek için çağıranın verdiği düzeltmedir.
 */
export function gelirTablosuKur(
  satirlar: MizanSatiri[],
  kapanisHaric: ReadonlyMap<string, number> = new Map(),
): { kalemler: GelirTablosuKalemi[]; netKar: number } {
  // Kebir başına dönem neti (borç − alacak), kapanış fişleri hariç.
  const donem = new Map<string, number>()
  for (const s of satirlar) {
    if (s.duzey !== 3 || (s.kod[0] !== "6" && s.kod[0] !== "7")) continue
    donem.set(s.kod, r2(s.donemBorc - s.donemAlacak - (kapanisHaric.get(s.kod) ?? 0)))
  }
  // 7. sınıfın neti karşılık geldiği 6xx'e (7x0 + 7x1 … aynı gruba gider).
  const alti = new Map<string, number>()
  for (const [kod, v] of donem) {
    const hedef = kod[0] === "7" ? yansimaHesabi(kod) : kod
    if (!hedef || r2(v) === 0) continue
    alti.set(hedef, r2((alti.get(hedef) ?? 0) + v))
  }
  /** Grup toplamı: gelir grupları alacak (−net), gider grupları borç (+net) pozitif yazılır. */
  const grup = (onek: string, gelir: boolean) => {
    let t = 0
    const s: TabloSatiri[] = []
    for (const [kod, v] of alti) {
      if (!kod.startsWith(onek)) continue
      const tutar = r2(gelir ? -v : v)
      t += tutar
      s.push({ kod, ad: tekduzenHesabi(kod)?.ad ?? kod, tutar })
    }
    return { tutar: r2(t), satirlar: s.sort((a, b) => a.kod.localeCompare(b.kod)) }
  }
  const brut = grup("60", true)
  const indirim = grup("61", false)
  const netSatis = r2(brut.tutar - indirim.tutar)
  const maliyet = grup("62", false)
  const brutKar = r2(netSatis - maliyet.tutar)
  const faaliyet = grup("63", false)
  const faaliyetKari = r2(brutKar - faaliyet.tutar)
  const digerGelir = grup("64", true)
  const digerGider = grup("65", false)
  const finansman = grup("66", false)
  const olaganKar = r2(faaliyetKari + digerGelir.tutar - digerGider.tutar - finansman.tutar)
  const olaganDisiGelir = grup("67", true)
  const olaganDisiGider = grup("68", false)
  const donemKari = r2(olaganKar + olaganDisiGelir.tutar - olaganDisiGider.tutar)
  const vergi = grup("691", false)
  const netKar = r2(donemKari - vergi.tutar)

  const kalemler: GelirTablosuKalemi[] = [
    { kod: "A", ad: "Brüt Satışlar", ...brut },
    { kod: "B", ad: "Satış İndirimleri (-)", ...indirim },
    { kod: "C", ad: "Net Satışlar", tutar: netSatis, ara: true },
    { kod: "D", ad: "Satışların Maliyeti (-)", ...maliyet },
    { kod: "", ad: "Brüt Satış Kârı veya Zararı", tutar: brutKar, ara: true },
    { kod: "E", ad: "Faaliyet Giderleri (-)", ...faaliyet },
    { kod: "", ad: "Faaliyet Kârı veya Zararı", tutar: faaliyetKari, ara: true },
    { kod: "F", ad: "Diğer Faaliyetlerden Olağan Gelir ve Kârlar", ...digerGelir },
    { kod: "G", ad: "Diğer Faaliyetlerden Olağan Gider ve Zararlar (-)", ...digerGider },
    { kod: "H", ad: "Finansman Giderleri (-)", ...finansman },
    { kod: "", ad: "Olağan Kâr veya Zarar", tutar: olaganKar, ara: true },
    { kod: "I", ad: "Olağandışı Gelir ve Kârlar", ...olaganDisiGelir },
    { kod: "J", ad: "Olağandışı Gider ve Zararlar (-)", ...olaganDisiGider },
    { kod: "", ad: "Dönem Kârı veya Zararı", tutar: donemKari, ara: true },
    { kod: "K", ad: "Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)", ...vergi },
    { kod: "", ad: "Dönem Net Kârı veya Zararı", tutar: netKar, ara: true },
  ]
  return { kalemler, netKar }
}
