/**
 * Muhasebe defteri dışa aktarımları: mizan, yevmiye, kebir, bilanço + gelir tablosu
 * (2026-10-09). Müşavirin ilk istediği dosyalar; ekranla AYNI sorgulardan kurulur
 * (`lib/muhasebe/defter-sorgu.server.ts`), dosya ekrandan ayrışmasın.
 *
 * Defter tüzel kişidedir: veri ve antet defterin sahibinden (şubede ana firma — ama modül
 * şubeye açılmadığı için uç oraya zaten MODULE_LOCKED döner). Kapı: `/api/export/muhasebe-`
 * modül kuralı (`accounting`) + sayfa kuralı (muhasebe ekranları).
 *
 * Resmî olan ONAYLI fişlerdir; "taslaklar dahil" ön izlemesi dosyaya da yazılır ve filtre
 * satırında söylenir — altı ay sonra açılan dosya resmî mi değil mi belli olsun.
 */

import { defterBaglami } from "@/lib/muhasebe/defter.server"
import { gunParam, kuruluDefter } from "@/lib/muhasebe/istek.server"
import { kebir, maliTabloMizanlari, mizan, mizanHesapsiz, yevmiye } from "@/lib/muhasebe/defter-sorgu.server"
import { mizanToplami, type MizanSatiri } from "@/lib/muhasebe/mizan"
import { bilancoKur, gelirTablosuKur, type TabloBolumu } from "@/lib/muhasebe/mali-tablolar"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import type { ExportColumn, ExportDataset, ExportRow } from "../types"
import { describeDateRange, describeFilters, loadExportCompany } from "./context"

type Params = URLSearchParams

/** Yevmiyenin dosyaya yazılan madde tavanı (ekran sayfalı; dosya dönemi bütün verir). */
const YEVMIYE_TAVANI = 20_000

async function defter(companyId: string) {
  const ctx = await defterBaglami(companyId)
  if (!ctx) throw new FisHatasi("Firma bulunamadı", 404)
  const d = kuruluDefter(ctx)
  return { defterId: d.defterId, company: await loadExportCompany(d.defterId) }
}

function donem(params: Params) {
  return { bas: gunParam(params.get("bas"), "Başlangıç"), bit: gunParam(params.get("bit"), "Bitiş") }
}

const taslakNotu = (taslak: boolean) => (taslak ? "Taslaklar dahil (ÖN İZLEME — resmî değil)" : "Yalnız onaylı fişler")

// --------------------------- MİZAN ---------------------------

const MIZAN_DUZEYLERI: Record<string, string> = { "1": "Sınıf", "2": "Grup", "3": "Defteri kebir", detay: "Alt hesaplarla" }

const MIZAN_KOLONLARI: ExportColumn[] = [
  { key: "kod", label: "Hesap Kodu", width: 22 },
  { key: "ad", label: "Hesap Adı", width: 60 },
  { key: "devirBorc", label: "Devir Borç", type: "money" },
  { key: "devirAlacak", label: "Devir Alacak", type: "money" },
  { key: "donemBorc", label: "Dönem Borç", type: "money" },
  { key: "donemAlacak", label: "Dönem Alacak", type: "money" },
  { key: "toplamBorc", label: "Toplam Borç", type: "money" },
  { key: "toplamAlacak", label: "Toplam Alacak", type: "money" },
  { key: "bakiyeBorc", label: "Borç Bakiyesi", type: "money" },
  { key: "bakiyeAlacak", label: "Alacak Bakiyesi", type: "money" },
]

/** Ekrandaki düzey süzgeciyle aynı (app/(dashboard)/muhasebe/mizan). */
export function mizanDuzeyi(satirlar: MizanSatiri[], duzey: string): MizanSatiri[] {
  if (duzey === "detay") return satirlar.filter((s) => s.duzey >= 3)
  const n = Number(duzey)
  return satirlar.filter((s) => s.duzey === (n >= 1 && n <= 3 ? n : 3))
}

export async function buildMizanDataset(companyId: string, params: Params): Promise<ExportDataset> {
  const { defterId, company } = await defter(companyId)
  const d = donem(params)
  const taslak = params.get("taslak") === "1"
  const duzey = MIZAN_DUZEYLERI[params.get("duzey") ?? ""] ? (params.get("duzey") as string) : "3"
  const [satirlar, hesapsiz] = await Promise.all([
    mizan(defterId, { ...d, taslakDahil: taslak }),
    taslak ? mizanHesapsiz(defterId, { ...d, taslakDahil: taslak }) : null,
  ])
  const gosterilen = mizanDuzeyi(satirlar, duzey)
  // Alt hesap kırılımında satırlar kebirle çakışır: dip toplam her zaman kebir düzeyinden.
  const toplam = mizanToplami(satirlar, duzey === "detay" ? 3 : Number(duzey))
  const eksik = hesapsiz && (hesapsiz.borc || hesapsiz.alacak) ? hesapsiz : null
  return {
    title: "Mizan",
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", describeDateRange(d.bas, d.bit)],
      ["Düzey", MIZAN_DUZEYLERI[duzey]],
      ["Kapsam", taslakNotu(taslak)],
    ]),
    note: eksik
      ? `${eksik.fisSayisi} taslak fişte hesabı seçilmemiş satırlar mizana girmedi (borç ${eksik.borc.toLocaleString("tr-TR")}, alacak ${eksik.alacak.toLocaleString("tr-TR")}).`
      : null,
    sections: [
      {
        title: "Mizan",
        columns: MIZAN_KOLONLARI,
        rows: gosterilen.map((s) => ({
          ...s,
          // Alt hesaplar kebirin altında girintili okunur (Excel'de de).
          ad: duzey === "detay" && s.duzey > 3 ? `${"  ".repeat(s.duzey - 3)}${s.ad}` : s.ad,
        })),
        totals: { kod: "", ad: "Toplam", ...toplam },
      },
    ],
  }
}

// --------------------------- YEVMİYE ---------------------------

export async function buildYevmiyeDataset(companyId: string, params: Params): Promise<ExportDataset> {
  const { defterId, company } = await defter(companyId)
  const d = donem(params)
  const sonuc = await yevmiye(defterId, d, { atla: 0, al: YEVMIYE_TAVANI })
  const rows: ExportRow[] = sonuc.maddeler.flatMap((m) =>
    m.satirlar.map((s) => ({
      madde: m.maddeNo,
      fisNo: m.voucherNo,
      tarih: m.tarih,
      kod: s.kod,
      ad: s.ad,
      aciklama: s.aciklama ?? m.aciklama ?? "",
      borc: s.borc,
      alacak: s.alacak,
    })),
  )
  return {
    title: "Yevmiye Defteri",
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", describeDateRange(d.bas, d.bit)],
      ["Kapsam", "Onaylı fişler"],
    ]),
    note: sonuc.toplam > YEVMIYE_TAVANI ? `Dönemde ${sonuc.toplam.toLocaleString("tr-TR")} madde var; ilk ${YEVMIYE_TAVANI.toLocaleString("tr-TR")} madde yazıldı. Dönemi daraltın.` : null,
    sections: [
      {
        title: "Yevmiye",
        columns: [
          { key: "madde", label: "Madde", type: "number", width: 14 },
          { key: "fisNo", label: "Fiş No", width: 26 },
          { key: "tarih", label: "Tarih", type: "date", width: 22 },
          { key: "kod", label: "Hesap Kodu", width: 24 },
          { key: "ad", label: "Hesap Adı", width: 50 },
          { key: "aciklama", label: "Açıklama", width: 70 },
          { key: "borc", label: "Borç", type: "money", total: true },
          { key: "alacak", label: "Alacak", type: "money", total: true },
        ],
        rows,
        totals: { madde: null, fisNo: "", tarih: null, kod: "", ad: "", aciklama: "Toplam", borc: sonuc.borc, alacak: sonuc.alacak },
      },
    ],
  }
}

// --------------------------- KEBİR ---------------------------

export async function buildKebirDataset(companyId: string, params: Params): Promise<ExportDataset> {
  const { defterId, company } = await defter(companyId)
  const d = donem(params)
  const hesap = (params.get("hesap") ?? "").trim()
  if (!hesap) throw new FisHatasi("Hesap kodu seçin.")
  const sonuc = await kebir(defterId, hesap, d)
  if (!sonuc.hesap) throw new FisHatasi(`${hesap} kodlu hesap yok.`, 404)
  const son = sonuc.satirlar.length ? sonuc.satirlar[sonuc.satirlar.length - 1].bakiye : sonuc.devir
  return {
    title: `Kebir — ${sonuc.hesap.kod} ${sonuc.hesap.ad}`,
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Hesap", `${sonuc.hesap.kod} ${sonuc.hesap.ad} (alt hesaplarıyla)`],
      ["Dönem", describeDateRange(d.bas, d.bit)],
      ["Kapsam", "Onaylı fişler"],
    ]),
    sections: [
      {
        title: "Kebir",
        columns: [
          { key: "tarih", label: "Tarih", type: "date", width: 22 },
          { key: "fisNo", label: "Fiş No", width: 26 },
          { key: "kod", label: "Hesap", width: 24 },
          { key: "aciklama", label: "Açıklama", width: 80 },
          { key: "borc", label: "Borç", type: "money" },
          { key: "alacak", label: "Alacak", type: "money" },
          { key: "bakiye", label: "Bakiye (B − A)", type: "money" },
        ],
        rows: [
          { tarih: d.bas, fisNo: "", kod: "", aciklama: "Devir", borc: null, alacak: null, bakiye: sonuc.devir },
          ...sonuc.satirlar.map((s) => ({
            tarih: s.tarih,
            fisNo: s.voucherNo,
            kod: s.hesapKodu,
            aciklama: s.aciklama ?? "",
            borc: s.borc,
            alacak: s.alacak,
            bakiye: s.bakiye,
          })),
        ],
        totals: { tarih: null, fisNo: "", kod: "", aciklama: "Toplam", borc: sonuc.borc, alacak: sonuc.alacak, bakiye: son },
      },
    ],
  }
}

// --------------------------- BİLANÇO + GELİR TABLOSU ---------------------------

const TABLO_KOLONLARI: ExportColumn[] = [
  { key: "kod", label: "Kod", width: 20 },
  { key: "kalem", label: "Kalem", width: 100 },
  { key: "tutar", label: "Tutar", type: "money", width: 40 },
]

/** Bölüm → grup → hesap, girintiyle (ekrandaki ağaçla aynı sıra). */
function bilancoSatirlari(bolumler: TabloBolumu[]): ExportRow[] {
  return bolumler.flatMap((b) => [
    { kod: b.kod, kalem: b.ad.toLocaleUpperCase("tr-TR"), tutar: b.tutar },
    ...b.gruplar.flatMap((g) => [
      { kod: g.kod, kalem: `  ${g.ad}`, tutar: g.tutar },
      ...g.satirlar.map((s) => ({ kod: s.kod, kalem: `    ${s.ad}`, tutar: s.tutar })),
    ]),
  ])
}

export async function buildMaliTablolarDataset(companyId: string, params: Params): Promise<ExportDataset> {
  const { defterId, company } = await defter(companyId)
  const { bas, bit } = donem(params)
  if (!bas || !bit) throw new FisHatasi("Dönem seçin.")
  const taslak = params.get("taslak") === "1"
  const { bilancoMizani, donemMizani } = await maliTabloMizanlari(defterId, { bas, bit, taslakDahil: taslak })
  const bilanco = bilancoKur(bilancoMizani)
  const gelir = gelirTablosuKur(donemMizani)
  return {
    title: "Bilanço ve Gelir Tablosu",
    company,
    orientation: "portrait",
    filters: describeFilters([
      ["Bilanço", `${describeDateRange(bit, null)} itibarıyla`],
      ["Gelir tablosu", describeDateRange(bas, bit)],
      ["Kapsam", taslakNotu(taslak)],
    ]),
    note:
      Math.abs(bilanco.aktifToplam - bilanco.pasifToplam) >= 0.01
        ? `Aktif (${bilanco.aktifToplam.toLocaleString("tr-TR")}) ile pasif (${bilanco.pasifToplam.toLocaleString("tr-TR")}) denk değil — nedeni ekrandaki notlarda.`
        : null,
    sections: [
      {
        title: "Bilanço — Aktif (Varlıklar)",
        sheetName: "Aktif",
        columns: TABLO_KOLONLARI,
        rows: bilancoSatirlari(bilanco.aktif),
        totals: { kod: "", kalem: "Aktif toplamı", tutar: bilanco.aktifToplam },
      },
      {
        title: "Bilanço — Pasif (Kaynaklar)",
        sheetName: "Pasif",
        columns: TABLO_KOLONLARI,
        rows: bilancoSatirlari(bilanco.pasif),
        totals: { kod: "", kalem: "Pasif toplamı", tutar: bilanco.pasifToplam },
      },
      {
        title: "Gelir Tablosu",
        sheetName: "Gelir Tablosu",
        columns: TABLO_KOLONLARI,
        rows: gelir.kalemler.flatMap((k) => [
          { kod: k.kod, kalem: k.ara ? k.ad.toLocaleUpperCase("tr-TR") : k.ad, tutar: k.tutar },
          ...(k.satirlar ?? []).map((s) => ({ kod: s.kod, kalem: `    ${s.ad}`, tutar: s.tutar })),
        ]),
        totals: { kod: "", kalem: gelir.netKar >= 0 ? "Dönem net kârı" : "Dönem net zararı", tutar: gelir.netKar },
      },
    ],
  }
}
