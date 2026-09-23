/**
 * CARİ VİRMAN FİŞİ — kasaya dokunmadan cari bakiyesi aktaran kayıt.
 *
 * Müşteri ABC, bizim tedarikçi XYZ'ye olan borcumuzu doğrudan ödedi. Kasaya para
 * girmedi, çıkmadı; ama ABC'nin bize borcu ve bizim XYZ'ye borcumuz düştü:
 *
 *   XYZ (tedarikçi)  Virman Borç    10.000   → bizim XYZ'ye borcumuz düşer
 *   ABC (müşteri)    Virman Alacak  10.000   → ABC'nin bize borcu düşer
 *
 * Aynı yapı aynı firmanın müşteri ↔ tedarikçi kartı arasındaki mahsubu ve bir
 * müşterinin borcunun başka müşteriye devrini de karşılar.
 *
 * ── Yön sözlüğü ─────────────────────────────────────────────────────────────
 * Ekstrenin kendi ekseni (lib/cari/ekstre-query.ts): DEBIT BORÇ sütununa,
 * CREDIT ALACAK sütununa yazılır — müşteride de tedarikçide de. Bakiyeye etkisi
 * carinin türüne göre işaret değiştirir, çünkü iki kartın bakiyesi aynalıdır:
 *
 *   müşteri bakiyesi   = borç − alacak   (pozitif: bize borçlu)
 *   tedarikçi bakiyesi = alacak − borç   (pozitif: biz ona borçluyuz)
 *
 * ── Tek taraflı fiş ─────────────────────────────────────────────────────────
 * Karşı cari İSTEĞE BAĞLIDIR (müşteri kararı, 2026-09-23). Tek bacaklı fiş
 * karşılıksız bir borç/alacak dekontudur: bakiyeyi değiştirir, hiçbir yerden
 * düşmez. Kâr/zarar ve gelir-gidere BİLEREK girmez (bakiye kapama ile aynı
 * gerekçe: belge kesilmeden vergisel gelir/gider değildir).
 *
 * ── Neden altıncı bir bakiye kaynağı ────────────────────────────────────────
 * Mevcut kayıtların hiçbiri taşıyamıyor: Transaction kasa hesabı, InvoicePayment
 * fatura ister, bakiye kapama yalnız açık faturayı kapatır. Yeni kaynak, cari
 * bakiyesini kuran HER yere tek tek girer — listesi `VIRMAN_OKUYAN_YERLER`de,
 * eşitlikleri `lib/cari/bakiye-tutarlilik.canli.test.ts` ile ölçülür.
 *
 * Saf modül: istemci (virman penceresi, ekstre rozetleri) ve sunucu (uç,
 * bakiye kurucuları) aynı kuralı okur.
 */

export type VirmanSide = "DEBIT" | "CREDIT"
export type CariKind = "customer" | "supplier"

/** Ekstre / kart hareket satırının türü. */
export const VIRMAN_ENTRY_TYPE = "VIRMAN" as const

export const VIRMAN_SIDE_LABEL: Record<VirmanSide, string> = {
  DEBIT: "Virman Borç",
  CREDIT: "Virman Alacak",
}

/**
 * Virmanı OKUMAK zorunda olan bakiye kurucuları. Belge amaçlıdır — yeni bir
 * cari bakiyesi hesaplayan yer yazılırsa buraya eklenmeli ve tutarlılık
 * testine girmelidir.
 */
export const VIRMAN_OKUYAN_YERLER = [
  "lib/cari/list-query.ts (müşteri + tedarikçi listesi bakiyesi)",
  "app/api/cari/customers/[id]/route.ts (kart bakiyesi + hareket tablosu)",
  "app/api/cari/suppliers/[id]/route.ts (kart bakiyesi + hareket tablosu)",
  "lib/cari/ekstre-query.ts (ekstre satırı)",
  "lib/raporlar/cari-yaslandirma.ts (yaşlandırma kalemi / kredi havuzu)",
  "lib/cari/archive-guard.ts (arşiv/silme kapısı)",
] as const

export function isVirmanSide(value: unknown): value is VirmanSide {
  return value === "DEBIT" || value === "CREDIT"
}

export function oppositeSide(side: VirmanSide): VirmanSide {
  return side === "DEBIT" ? "CREDIT" : "DEBIT"
}

/** Bacağın ekstre sütunları — ekstre, kart tablosu ve dışa aktarım aynı kuralı kullanır. */
export function virmanSatirYonu(side: VirmanSide, amount: number): { debit: number; credit: number } {
  return side === "DEBIT" ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
}

/**
 * Bacağın carinin KENDİ bakiyesine etkisi (kartın işaret sözleşmesinde).
 * Müşteride borç bakiyeyi artırır; tedarikçide borç, bizim ona borcumuzu azaltır.
 */
export function virmanBakiyeEtkisi(kind: CariKind, side: VirmanSide, amount: number): number {
  const debitMinusCredit = side === "DEBIT" ? amount : -amount
  return kind === "customer" ? debitMinusCredit : -debitMinusCredit
}

// ── Girdi doğrulama ─────────────────────────────────────────────────────────

export type VirmanParty = { kind: CariKind; id: string }

export type VirmanInput = {
  /** Fişin girildiği cari. */
  party: VirmanParty
  /** Bu carinin yönü: DEBIT = "Virman Borç", CREDIT = "Virman Alacak". */
  side: VirmanSide
  /** Karşı cari — verilirse TERS yönde bacak alır; verilmezse fiş tek taraflıdır. */
  counterparty: VirmanParty | null
  amount: number
  date: Date
  description: string | null
}

export const VIRMAN_DESCRIPTION_MAX = 500

const isKind = (v: unknown): v is CariKind => v === "customer" || v === "supplier"

function parseParty(raw: unknown): VirmanParty | null {
  if (!raw || typeof raw !== "object") return null
  const { kind, id } = raw as { kind?: unknown; id?: unknown }
  if (!isKind(kind) || typeof id !== "string" || id.trim().length === 0) return null
  return { kind, id: id.trim() }
}

/**
 * İstek gövdesini doğrular. Yetki/varlık denetimi (cari bu firmanın mı, görünür
 * mü, arşivde mi) burada DEĞİL, uçtadır — bu fonksiyon yalnız şekli söyler.
 */
export function parseVirmanInput(
  body: unknown,
): { ok: true; value: VirmanInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>

  const party = parseParty(b.party)
  if (!party) return { ok: false, error: "Cari seçilmedi" }

  if (!isVirmanSide(b.side)) return { ok: false, error: "Virman yönü (borç/alacak) seçilmedi" }

  let counterparty: VirmanParty | null = null
  if (b.counterparty !== undefined && b.counterparty !== null && b.counterparty !== "") {
    counterparty = parseParty(b.counterparty)
    if (!counterparty) return { ok: false, error: "Karşı cari geçersiz" }
    if (counterparty.kind === party.kind && counterparty.id === party.id) {
      return { ok: false, error: "Karşı cari, fişin girildiği cariyle aynı olamaz" }
    }
  }

  const amount = typeof b.amount === "number" ? b.amount : Number(String(b.amount ?? "").replace(",", "."))
  if (!Number.isFinite(amount) || !(amount > 0)) return { ok: false, error: "Tutar 0'dan büyük olmalı" }
  // Kuruştan küçük hane sessizce yuvarlanmaz: kolon 2 ondalık, fark bakiyede kalırdı.
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(6))) {
    return { ok: false, error: "Tutar en fazla 2 ondalık basamak içerebilir" }
  }
  if (amount >= 1e13) return { ok: false, error: "Tutar çok büyük" }

  let date = new Date()
  if (b.date !== undefined && b.date !== null && b.date !== "") {
    date = new Date(String(b.date))
    if (Number.isNaN(date.getTime())) return { ok: false, error: "Tarih geçersiz" }
  }

  const rawDescription = typeof b.description === "string" ? b.description.trim() : ""
  if (rawDescription.length > VIRMAN_DESCRIPTION_MAX) {
    return { ok: false, error: `Açıklama en fazla ${VIRMAN_DESCRIPTION_MAX} karakter olabilir` }
  }

  return {
    ok: true,
    value: {
      party,
      side: b.side,
      counterparty,
      amount: Math.round(amount * 100) / 100,
      date,
      description: rawDescription || null,
    },
  }
}

/** Fişin bacakları: fişin girildiği cari + (varsa) karşı cari ters yönde. */
export function virmanBacaklari(input: Pick<VirmanInput, "party" | "side" | "counterparty">): Array<{
  side: VirmanSide
  party: VirmanParty
}> {
  const legs: Array<{ side: VirmanSide; party: VirmanParty }> = [{ side: input.side, party: input.party }]
  if (input.counterparty) legs.push({ side: oppositeSide(input.side), party: input.counterparty })
  return legs
}

// ── Numara ──────────────────────────────────────────────────────────────────

export const VIRMAN_NO_PREFIX = "VRM-"

export function formatVirmanNo(seq: number): string {
  return `${VIRMAN_NO_PREFIX}${String(seq).padStart(6, "0")}`
}

/** "VRM-000042" → 42; biçim dışı numara 0 sayılır. */
export function parseVirmanSeq(virmanNo: string | null | undefined): number {
  const m = /^VRM-(\d+)$/.exec(String(virmanNo ?? ""))
  return m ? Number(m[1]) : 0
}

// ── Satır metni ─────────────────────────────────────────────────────────────

/**
 * Ekstre/kart satırının açıklaması: "Virman VRM-000012 · karşı: ABC Ltd — not".
 * Karşı cari yoksa "(tek taraflı)" yazılır: satır karşılıksız bir dekonttur ve
 * okuyan bunu bilmeli.
 */
export function virmanAciklamasi(args: {
  virmanNo: string
  counterpartyName: string | null
  description: string | null
}): string {
  const karsi = args.counterpartyName ? `karşı: ${args.counterpartyName}` : "tek taraflı"
  return `Virman ${args.virmanNo} · ${karsi}${args.description ? ` — ${args.description}` : ""}`
}
