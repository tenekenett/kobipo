/**
 * Müşteri kartındaki KAMU KURUMU bilgisi — gövdeden okuma ve doğrulama (saf).
 * Belgeye nasıl girdiği: lib/integrations/e-invoice/public-invoice.ts.
 *
 * POST ve PUT aynı fonksiyondan geçer. PUT'ta gönderilmeyen alan mevcut değerde kalır
 * (ikiz kart ve toplu güncellemeler bu alanları taşımıyor; boşaltılmamalı).
 */
import { isEligiblePublicAccount, resolvePublicPayee, type PublicInvoiceAccount } from "@/lib/integrations/e-invoice/public-invoice"

export type KamuBilgisi = {
  isPublicInstitution: boolean
  publicPaymentAccountId: string | null
  publicPayeeVkn: string | null
  publicPayeeName: string | null
  publicPayeeCity: string | null
  publicPayeeDistrict: string | null
}

export const BOS_KAMU_BILGISI: KamuBilgisi = {
  isPublicInstitution: false,
  publicPaymentAccountId: null,
  publicPayeeVkn: null,
  publicPayeeName: null,
  publicPayeeCity: null,
  publicPayeeDistrict: null,
}

const KAMU_KEYS = Object.keys(BOS_KAMU_BILGISI) as Array<keyof KamuBilgisi>

/**
 * Gövde kamu alanlarından birini taşıyor mu? Taşımayan güncelleme (ör. başka bir
 * ekrandan yalnız telefon) doğrulamaya sokulmaz: seçili hesap sonradan pasife
 * alındıysa ilgisiz bir yazma 400 almasın — sorun gönderimde zaten söylenir.
 */
export function kamuAlaniGeldi(body: Record<string, unknown>): boolean {
  return KAMU_KEYS.some((key) => body[key] !== undefined)
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/** Gövdedeki kamu alanlarını mevcut kaydın üstüne yazar (gönderilmeyen = dokunma). */
export function mergeKamuBilgisi(body: Record<string, unknown>, current: KamuBilgisi | null): KamuBilgisi {
  const base = current ?? BOS_KAMU_BILGISI
  const pick = <K extends keyof KamuBilgisi>(key: K, parse: (v: unknown) => KamuBilgisi[K]): KamuBilgisi[K] =>
    body[key] !== undefined ? parse(body[key]) : base[key]
  const vkn = pick("publicPayeeVkn", (v) => text(v)?.replace(/\D/g, "") || null)
  return {
    isPublicInstitution: pick("isPublicInstitution", (v) => v === true || v === "true"),
    publicPaymentAccountId: pick("publicPaymentAccountId", text),
    publicPayeeVkn: vkn,
    publicPayeeName: pick("publicPayeeName", text),
    publicPayeeCity: pick("publicPayeeCity", text),
    publicPayeeDistrict: pick("publicPayeeDistrict", text),
  }
}

/**
 * Kaydedilebilir mi? Seçilen hesap firmanın UYGUN hesabı olmalı (aktif, banka, TL,
 * geçerli IBAN) ve harcama birimi ya tam ya boş olmalı. `account` = seçilen hesabın
 * firmada bulunan kaydı (bulunamadıysa null).
 */
export function kamuBilgisiHatasi(v: KamuBilgisi, account: PublicInvoiceAccount | null): string | null {
  if (v.publicPaymentAccountId) {
    if (!account) return "Kamu faturası için seçilen ödeme hesabı bu firmada bulunamadı."
    if (!isEligiblePublicAccount(account)) {
      return `Kamu faturası için seçilen "${account.name}" hesabı kullanılamaz: aktif, TL bir banka hesabı olmalı ve geçerli bir TR IBAN'ı bulunmalı.`
    }
  }
  const payee = resolvePublicPayee({
    vkn: v.publicPayeeVkn,
    name: v.publicPayeeName,
    city: v.publicPayeeCity,
    district: v.publicPayeeDistrict,
  })
  return payee.ok ? null : payee.error
}
