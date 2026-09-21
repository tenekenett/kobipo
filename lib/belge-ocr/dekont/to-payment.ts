/**
 * Dekont → TEK kasa/banka hareketi (`POST /api/finans/transactions`) — saf.
 *
 * Bir dekont bir PARA HAREKETİDİR: 1.500 TL'lik havale iki faturayı kapatsa da
 * banka ekstresinde tek satırdır. Eskiden burada her fatura için ayrı bir
 * `/api/faturalar/odemeler` POST'u kuruluyordu ve tek havale N kasa hareketine
 * bölünüyordu (uçtan uca testte 28 açık faturaya dağıtılan bir dekont 28 banka
 * hareketi yazdı) — banka mutabakatı bunun üstünde yürümez. Uç zaten tek işlem
 * + çoklu fatura dağıtımını yapıyor.
 *
 * Dağıtım kuralı KOPYALANMAZ: `lib/cari/odeme-dagit.ts`. Uç da aynı fonksiyonu
 * çağırdığı için kartta gösterilen dağıtım ile kaydedilen birebir aynıdır
 * (kuruş aritmetiği tam sayıyla yapılır; float toplama gerçek veride "tutar
 * açık kısımdan büyük" hatası üretmişti).
 *
 * C1 KARARI (2026-09-21): faturalara sığmayan tutar KAYBOLMAZ, cariye AVANS
 * olarak kalır — işlem cariye yazılır, o kısım için `InvoicePayment` üretilmez.
 * Bu yüzden "açık faturası yok" artık kaydı engellemez; dekont cariye avans
 * olarak girer ve sonraki fatura kesildiğinde kapatılır.
 *
 * Ödeme yöntemi burada SEÇİLMEZ: uç, kanalın türünden okur (POS hesabına yazılan
 * dekont kredi kartı olur, banka hesabına yazılan havale).
 */

import { odemeDagit } from "@/lib/cari/odeme-dagit"
import type { Dekont } from "./schema"

const r2 = (n: number) => Math.round(n * 100) / 100

export type AcikFatura = { id: string; invoiceNo: string; date: string; kalan: number }

export type DekontYonuSecimi = "TAHSILAT" | "ODEME"

/** `POST /api/finans/transactions` gövdesi (yalnız dekontun kullandığı alanlar). */
export type DekontIslemGovdesi = {
  companyId: string
  accountId: string
  type: "INCOME" | "EXPENSE"
  amount: number
  currency: string
  description: string
  date: string
  reference?: string
  customerId?: string
  supplierId?: string
  invoiceIds?: string[]
}

export type DekontPayi = { invoiceId: string; invoiceNo: string; amount: number }

export type DekontUyarisi = { anahtar: "tutar" | "hesap" | "cari" | "avans" | "fatura"; mesaj: string; agir?: boolean }

export type DekontDonusumu = {
  /** Eksik bilgi varsa null — kart kaydı kilitler */
  body: DekontIslemGovdesi | null
  /** Önizleme: hangi faturaya ne kadar (uç aynı sırayla aynısını yazar) */
  dagitim: DekontPayi[]
  /** Faturalara sığmayan, cariye avans kalan tutar */
  avans: number
  uyarilar: DekontUyarisi[]
}

export type DekontDonusumSecenegi = {
  companyId: string
  yon: DekontYonuSecimi
  /** Seçili müşteri (tahsilat) ya da tedarikçi (ödeme) */
  cariId?: string | null
  /** Dekontun yazılacağı kasa/banka kartı — uç zorunlu tutar */
  accountId?: string | null
  /** Kullanıcının seçtiği açık faturalar (sıra önemsiz; burada eskiden yeniye dizilir) */
  faturalar: AcikFatura[]
  bugun?: Date
}

function aciklamaKur(d: Dekont, yon: DekontYonuSecimi): string {
  const parcalar = [
    `${yon === "TAHSILAT" ? "Tahsilat" : "Ödeme"} — dekont`,
    d.referansNo?.trim() || null,
    d.banka?.trim() || null,
    d.aciklama?.trim() || null,
  ].filter(Boolean) as string[]
  return parcalar.join(" · ").slice(0, 200)
}

export function dekontToIslem(d: Dekont, s: DekontDonusumSecenegi): DekontDonusumu {
  const uyarilar: DekontUyarisi[] = []
  const tutar = typeof d.tutar === "number" && Number.isFinite(d.tutar) ? r2(d.tutar) : 0
  if (tutar <= 0) {
    uyarilar.push({ anahtar: "tutar", mesaj: "Dekont tutarı okunamadı.", agir: true })
    return { body: null, dagitim: [], avans: 0, uyarilar }
  }

  // Dağıtım sırası EN ESKİDEN: uç da faturaları `date asc` çekip aynı kurala verir.
  const sirali = [...s.faturalar].sort((a, b) => a.date.localeCompare(b.date))
  const { allocations, remainder } = odemeDagit(tutar, sirali.map((f) => ({ id: f.id, openAmount: f.kalan })))
  const dagitim: DekontPayi[] = allocations.map((a) => ({
    invoiceId: a.invoiceId,
    invoiceNo: sirali.find((f) => f.id === a.invoiceId)?.invoiceNo ?? "",
    amount: a.amount,
  }))

  if (!s.accountId) {
    uyarilar.push({ anahtar: "hesap", mesaj: "Dekontun yazılacağı kasa/banka hesabını seçin.", agir: true })
  }
  if (!s.cariId) {
    uyarilar.push({
      anahtar: "cari",
      mesaj: s.yon === "TAHSILAT" ? "Tahsilatın yazılacağı müşteriyi seçin." : "Ödemenin yazılacağı tedarikçiyi seçin.",
      agir: true,
    })
  }
  if (dagitim.length === 0) {
    uyarilar.push({ anahtar: "fatura", mesaj: `Açık fatura seçilmedi; ${tutar.toFixed(2)} TL'nin tamamı cariye avans olarak yazılır.` })
  } else if (remainder > 0) {
    uyarilar.push({ anahtar: "avans", mesaj: `${remainder.toFixed(2)} TL seçili faturaların açığını aşıyor; cariye avans olarak kalır.` })
  }

  const tarih =
    d.islemTarihi && /^\d{4}-\d{2}-\d{2}/.test(d.islemTarihi)
      ? d.islemTarihi.slice(0, 10)
      : (s.bugun ?? new Date()).toISOString().slice(0, 10)

  const body: DekontIslemGovdesi | null =
    s.accountId && s.cariId
      ? {
          companyId: s.companyId,
          accountId: s.accountId,
          type: s.yon === "TAHSILAT" ? "INCOME" : "EXPENSE",
          amount: tutar,
          currency: (d.paraBirimi || "TRY").toUpperCase(),
          description: aciklamaKur(d, s.yon),
          date: tarih,
          ...(d.referansNo?.trim() ? { reference: d.referansNo.trim() } : {}),
          ...(s.yon === "TAHSILAT" ? { customerId: s.cariId } : { supplierId: s.cariId }),
          // Yalnız PAY ALAN faturalar gönderilir: tutarı biten seçim uca
          // "açık tutarı yok" dedirtirdi (uç hepsi kapalıysa 400 döner).
          ...(dagitim.length ? { invoiceIds: dagitim.map((a) => a.invoiceId) } : {}),
        }
      : null

  return { body, dagitim, avans: remainder, uyarilar }
}
