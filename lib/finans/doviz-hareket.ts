/**
 * DÖVİZLİ KASA/BANKA HAREKETİ — para birimi ve kur kararı. Saf modül, testli; yazan uç
 * `app/api/finans/transactions` (POST).
 *
 * Neden: hesap formu USD/EUR/GBP hesap açtırıyor ama hareket formları para birimini hep
 * "TRY" gönderiyordu — dövizli hesabın hareketi yanlış etiketle yazılıyordu. Kur da hiç
 * tutulmuyordu: muhasebe dövizli hareketi fişe sokamıyordu ("kur tutulmuyor").
 *
 * Kurallar:
 *   - Para birimi HESABIN para birimidir (istemcinin gönderdiği değil).
 *   - TRY harekette kur yok (null).
 *   - Dövizli hesapta CARİYE ya da FATURAYA bağlı hareket REDDEDİLİR: cari bakiyesi tek para
 *     birimlidir (TL); 100 USD'lik tahsilat cariden 100 TL düşerdi. Cari döviz desteği ayrı iş.
 *   - Para birimi farklı iki hesap arasında virman REDDEDİLİR (karşı bacak aynı tutarla
 *     yazılıyor; 100 USD → 100 TL olurdu).
 *   - Kur: istekte verildiyse o; verilmediyse ve hareket BUGÜNÜNse TCMB kuru (USD/EUR);
 *     aksi halde hata — geçmiş günün kurunu servis bilmiyor, sessizce bugünkü kur yazılmaz.
 */

export type DovizKarari = { ok: true; paraBirimi: string; kur: number | null; kaynak: "yok" | "istek" | "tcmb" } | { ok: false; hata: string }

const istanbulGunu = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)

export function hareketKuru(p: {
  hesapParaBirimi: string | null | undefined
  istekKuru: unknown
  tarih: Date
  simdi: Date
  /** TCMB kurları (1 birim = ? TL); alınamadıysa null. */
  tcmb: Partial<Record<string, number>> | null
  /** Hareket bir cariye ya da faturaya bağlı mı. */
  cariBagli: boolean
  /** Virmanda hedef hesabın para birimi. */
  virmanHedefParaBirimi?: string | null
}): DovizKarari {
  const pb = String(p.hesapParaBirimi || "TRY").toUpperCase()
  if (p.virmanHedefParaBirimi !== undefined && String(p.virmanHedefParaBirimi || "TRY").toUpperCase() !== pb) {
    return { ok: false, hata: "Para birimi farklı hesaplar arasında virman henüz desteklenmiyor." }
  }
  if (pb === "TRY") return { ok: true, paraBirimi: "TRY", kur: null, kaynak: "yok" }
  if (p.cariBagli) {
    return {
      ok: false,
      hata: `${pb} hesapta cariye ya da faturaya bağlı hareket henüz desteklenmiyor: cari bakiyeleri TL tutulur, ${pb} tutar TL gibi düşerdi.`,
    }
  }
  const ham = p.istekKuru
  if (ham !== undefined && ham !== null && String(ham).trim() !== "") {
    const kur = Number(String(ham).replace(",", "."))
    if (!Number.isFinite(kur) || kur <= 0) return { ok: false, hata: "Kur sıfırdan büyük bir sayı olmalı." }
    return { ok: true, paraBirimi: pb, kur: Math.round(kur * 1e6) / 1e6, kaynak: "istek" }
  }
  const tcmb = p.tcmb?.[pb]
  if (istanbulGunu(p.tarih) === istanbulGunu(p.simdi) && tcmb && tcmb > 0) {
    return { ok: true, paraBirimi: pb, kur: Math.round(tcmb * 1e6) / 1e6, kaynak: "tcmb" }
  }
  return { ok: false, hata: `${pb} hareketin kurunu girin (1 ${pb} = ? TL).` }
}
