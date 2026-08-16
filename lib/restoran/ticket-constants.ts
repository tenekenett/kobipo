// Adisyon ekranlarının SAF sabit ve hesapları — Prisma/DB bağı YOK.
//
// Neden ayrı dosya: bu tanımların bir kısmı (kalem durumları, sebep listeleri,
// toplam hesabı) İSTEMCİ tarafında da lazım. tickets.ts prisma import ettiği
// için oradan içe aktarmak Prisma istemcisini tarayıcı paketine sokardı.
// Sunucu tarafı bu dosyayı tickets.ts üzerinden görmeye devam ediyor.
//
// Kararlar: docs/restoran/ASAMA2.md · docs/restoran/SATIS-EKRANI.md

// Reçete etkisi tipi genişletme çekirdeğinden gelir (o dosya da saf ve
// izomorfik): seçeneğin stok karşılığı ile stoğu fiilen düşen mantık tek tanımı
// paylaşsın.
import { parseRecipeEffects, type RecipeEffect } from "@/lib/stock/recipe-expand"

export type { RecipeEffect }

/** Adisyon kalemi fiyatları NET (KDV hariç) tutulur — fatura API'si net bekler. */
export const TICKET_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/**
 * Kalemin akıbeti. Üçü de "sil" değildir ve stok davranışları FARKLIDIR
 * (docs/restoran/SATIS-EKRANI.md K2):
 *
 * | durum  | hesapta            | fişte | stok        |
 * |--------|--------------------|-------|-------------|
 * | NORMAL | tutarıyla          | var   | kapanışta   |
 * | COMP   | 0,00 satır olarak  | yok   | kapanışta   |
 * | WASTE  | görünmez           | yok   | kapanışta   |
 * | VOID   | görünmez           | yok   | hiç düşmez  |
 *
 * İkram (COMP) ve zayi (WASTE) stoktan DÜŞER: malzeme gerçekten harcandı.
 * Eskiden bunlar kalem silinerek yapılıyordu ve malzeme stokta duruyor
 * görünüyordu — maliyet raporlarını sessizce yalancı çıkaran durum buydu.
 */
export const TICKET_ITEM_STATUSES = ["NORMAL", "COMP", "WASTE", "VOID"] as const
export type TicketItemStatus = (typeof TICKET_ITEM_STATUSES)[number]

/** Hesaba ve fişe giren tek durum. */
export const isBillableItem = (status: string | null | undefined) =>
  (status ?? "NORMAL") === "NORMAL"

/** Malzemesi harcanmış sayılan durumlar — kapanışta stok düzeltmesi yazılır. */
export const consumesStock = (status: string | null | undefined) =>
  status === "COMP" || status === "WASTE"

/**
 * Sebep listeleri sabit ve kısa: serbest metin olsaydı rapor gruplanamazdı
 * ("ikram", "İKRAM", "ikram ettik" üç ayrı satır olurdu). Ayrıntı serbest
 * `reason` alanına yazılır ve o da ZORUNLUdur (bkz. `requiresReasonNote`).
 */
export const TICKET_ITEM_REASONS: Record<
  Exclude<TicketItemStatus, "NORMAL">,
  Array<{ code: string; label: string }>
> = {
  COMP: [
    { code: "COMPLAINT", label: "Müşteri şikâyeti" },
    { code: "STAFF", label: "Personel / aile" },
    { code: "PROMO", label: "Tanıtım ikramı" },
    { code: "OTHER", label: "Diğer" },
  ],
  WASTE: [
    { code: "SPILLED", label: "Döküldü / kırıldı" },
    { code: "WRONG_PREP", label: "Yanlış hazırlandı" },
    { code: "EXPIRED", label: "Bozuldu / süresi doldu" },
    { code: "OTHER", label: "Diğer" },
  ],
  VOID: [
    { code: "MISENTRY", label: "Yanlış girildi" },
    { code: "CUSTOMER_CANCEL", label: "Müşteri vazgeçti" },
    { code: "OTHER", label: "Diğer" },
  ],
}

/**
 * İŞARETLENEN HER kalemde serbest açıklama da ZORUNLUdur (2026-08-16).
 *
 * Sebep kodu işlemin türünü söyler ("Personel / aile", "Döküldü / kırıldı"),
 * hikâyesini söylemez: dört seçenekten biridir ve pratikte herkes aynısını
 * seçer. Kime/niçin verildiği, ne olduğu yazılmadığında denetim raporu ikramı
 * kaçaktan, zayiyi savurganlıktan, iptali yanlış girişten ayıramaz — kod
 * gruplama ekseni, açıklama tek tek kayda bakanın okuyacağı yer. İskonto
 * açıklamasının 2026-08-07'de zorunlu olma gerekçesiyle aynı (K3.1).
 *
 * `NORMAL` dışındaki üç durumu da kapsar ve KOŞULSUZdur (personel seçiminin
 * aksine bir kart/modül gerektirmez). Tek istisna `kalemler/[itemId]` DELETE:
 * adet 0'a inen kalem "yanlış girildi" sayılır, açıklama sorulmaz — o yol
 * arayüzde kapalı bir emniyet supabıdır (bkz. route yorumu).
 *
 * Kural üç yerde bu fonksiyondan okunur: istemci (`ticket-panel.tsx`, "Uygula"
 * kilidi), `kalemler/[itemId]` PATCH ve `api/restoran/ikram` POST.
 */
export const requiresReasonNote = (status: string | null | undefined) =>
  status === "COMP" || status === "WASTE" || status === "VOID"

/** Serbest açıklamanın sunucuda kırpıldığı sınır — istemci de aynı sınırı gösterir. */
export const TICKET_REASON_NOTE_MAX = 255

/**
 * ADİSYON iptal sebepleri (kalem sebeplerinden ayrı liste).
 *
 * Kalem iptalinde sebep baştan zorunluydu ama dolu bir hesabı tek tıkla iptal
 * etmek sebepsizdi — oysa kaçak tek kalemde değil, hesabın tamamında yapılır.
 * Liste kısa ve sabit: serbest metin olsaydı rapor gruplanamazdı.
 *
 * "Birleştirildi" burada YOK: birleştirme iptal değil, ayrı bir izle
 * (`mergedIntoId`) tutulur.
 */
export const TICKET_CANCEL_REASONS = [
  { code: "CUSTOMER_LEFT", label: "Müşteri vazgeçti / gitti" },
  { code: "MISOPENED", label: "Yanlış açıldı" },
  { code: "TEST", label: "Deneme / eğitim" },
  { code: "OTHER", label: "Diğer" },
] as const

/**
 * İSKONTO sebepleri. Kalem ve iptal sebepleriyle aynı gerekçe: sabit ve kısa,
 * çünkü denetim raporu bunları gruplar. Kasiyerin ayrıntısı serbest metin
 * `discountReason` alanına yazılır — kod onun yerine geçmez, yanında durur.
 */
export const TICKET_DISCOUNT_REASONS = [
  { code: "STAFF", label: "Personel / aile" },
  { code: "STUDENT", label: "Öğrenci" },
  { code: "LOYAL", label: "Sadık müşteri" },
  { code: "COMPLAINT", label: "Şikâyet telafisi" },
  { code: "PROMO", label: "Kampanya" },
  { code: "OTHER", label: "Diğer" },
] as const

export const discountReasonLabel = (code: string | null | undefined): string | null =>
  code ? (TICKET_DISCOUNT_REASONS.find((r) => r.code === code)?.label ?? null) : null

/**
 * İskonto satırının etiketi — hesabın altında, adisyon detayında ve FİŞTE aynı
 * metin görünür. Üç ekranın ayrı ayrı kurması, birinde personel adı eklenip
 * diğerinde unutulması demekti.
 *
 * Sıra bilinçli: önce ne kadar, sonra NİYE, sonra KİM. Uygulayan personel en
 * sonda çünkü müşteri için anlamsız, denetim için vazgeçilmez; öne alınırsa
 * "%10 · Ahmet Yılmaz" okunur ve sebep gözden kaçar.
 */
export function ticketDiscountLabel(ticket: {
  discountType?: string | null
  discountValue?: number | string | null
  discountReasonLabel?: string | null
  discountReason?: string | null
  discountEmployeeName?: string | null
} | null): string | null {
  if (!ticket?.discountType) return null
  const base = ticket.discountType === "PERCENT" ? `İskonto %${ticket.discountValue}` : "İskonto"
  return [base, ticket.discountReasonLabel, ticket.discountReason, ticket.discountEmployeeName]
    .filter(Boolean)
    .join(" · ")
}

export const cancelReasonLabel = (code: string | null | undefined): string | null =>
  code ? (TICKET_CANCEL_REASONS.find((r) => r.code === code)?.label ?? null) : null

export const reasonLabel = (status: string, code: string | null | undefined): string | null => {
  if (!code) return null
  const list = TICKET_ITEM_REASONS[status as Exclude<TicketItemStatus, "NORMAL">]
  return list?.find((r) => r.code === code)?.label ?? null
}

/**
 * Seçilen porsiyon/seçenek. `priceDelta` KDV DAHİL (menü fiyatı gibi).
 *
 * `effect`/`recipeFactor` seçim ANINDA kopyalanır — fiyatın ürün kartından
 * kopyalanmasıyla aynı gerekçe: menü sonradan düzenlense (soya sütü başka bir
 * karta bağlansa) açık adisyonun stok karşılığı değişmemeli.
 */
export type TicketItemOption = {
  groupName: string
  optionName: string
  priceDelta: number
  /** Reçete sapması: bileşen değişimi ya da ek malzeme. */
  effect?: RecipeEffect | null
  /** Porsiyon çarpanı ("büyük boy" = 1.5). */
  recipeFactor?: number | null
}

/**
 * Seçenek tanımının (DB satırı ya da API görünümü) reçete etkisi alanları.
 * Yapısal tip: hem Prisma satırı hem `OptionGroupView` şıkkı buna oturur.
 */
export type OptionEffectSource = {
  effectMode?: string | null
  fromProductId?: string | null
  toProductId?: string | null
  effectQuantity?: number | null
  effectUnit?: string | null
  recipeFactor?: number | null
}

/**
 * Seçenek tanımını genişleticinin anladığı etkiye çevirir.
 *
 * Yarım kalan tanım (hedefi silinmiş hammadde, miktarsız ekleme) SESSİZCE
 * etkisiz sayılır: menüdeki bir eksik yüzünden satış akışı durmamalı, stok da
 * uydurma bir miktarla bozulmamalı.
 */
export function optionEffect(option: OptionEffectSource): RecipeEffect | null {
  if (option.effectMode === "SWAP") {
    if (!option.fromProductId) return null
    return {
      mode: "SWAP",
      fromProductId: option.fromProductId,
      // Hedef yoksa "çıkar" demektir ("şekersiz") — bu geçerli bir tanımdır.
      toProductId: option.toProductId || null,
    }
  }
  if (option.effectMode === "ADD") {
    const quantity = Number(option.effectQuantity)
    if (!option.toProductId || !Number.isFinite(quantity) || quantity <= 0) return null
    return {
      mode: "ADD",
      productId: option.toProductId,
      quantity,
      unit: String(option.effectUnit || ""),
    }
  }
  return null
}

/**
 * Kalemin seçeneklerinden genişletici girdisi üretir.
 *
 * Çarpanlar ÇARPILARAK birleşir: "büyük boy" (1,5) + "duble" (2) = 3. Toplama
 * yapmak 1,5 + 2 = 3,5 gibi anlamsız bir sonuç verirdi.
 */
export function optionRecipeEffects(options: TicketItemOption[] | null | undefined): {
  effects: RecipeEffect[]
  recipeFactor: number
} {
  const effects: RecipeEffect[] = []
  let recipeFactor = 1
  for (const option of options ?? []) {
    if (option.effect) effects.push(option.effect)
    const factor = Number(option.recipeFactor)
    if (Number.isFinite(factor) && factor > 0 && factor !== 1) recipeFactor *= factor
  }
  return { effects, recipeFactor }
}

/** Json alanını güvenli okur: elle/eski kayıtlarda şekil garantisi yok. */
export function parseItemOptions(value: unknown): TicketItemOption[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      groupName: String(o.groupName ?? ""),
      optionName: String(o.optionName ?? ""),
      priceDelta: Number(o.priceDelta ?? 0) || 0,
      // Kaydedilmiş etkiyi genişleticinin kendi güvenli okuyucusu çözer:
      // tanınmayan/eksik şekil etkisiz sayılır.
      effect: parseRecipeEffects([o.effect])[0] ?? null,
      recipeFactor: Number.isFinite(Number(o.recipeFactor)) ? Number(o.recipeFactor) : null,
    }))
    .filter((o) => o.optionName)
}

/** Seçeneklerin kalem satırında gösterilecek özeti: "Büyük · Soya sütü". */
export const optionsLabel = (options: TicketItemOption[]) =>
  options.map((o) => o.optionName).join(" · ")

export const TABLE_SHAPES = ["SQUARE", "CIRCLE", "RECT"] as const

/**
 * Dükkan krokisi öğeleri. Masa DEĞİLLER: adisyon açılmaz, doluluk sayılmaz —
 * salonun neye benzediğini anlatırlar (bkz. ASAMA2.md "Dükkan krokisi").
 */
export const PLAN_ITEM_KINDS = [
  "WALL", // duvar / bölme
  "DOOR", // kapı / giriş
  "BAR", // bar, tezgâh, kasa
  "KITCHEN", // mutfak
  "WC", // tuvalet
  "STAIRS", // merdiven
  "PLANT", // bitki / dekor
  "SOFA", // sedir / köşe koltuk (masa DEĞİL: adisyon açılmaz)
  "FRIDGE", // dolap / buzdolabı / vitrin
  "STAGE", // sahne / canlı müzik alanı
  "TEXT", // serbest yazı ("Sigara içilir", "Teras")
] as const

export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number]

/** Öğe eklenirken kullanılan varsayılan ölçüler (ızgara hücresi). */
export function planItemDefaults(kind: string): { width: number; height: number } {
  switch (kind) {
    case "WALL":
      return { width: 8, height: 1 }
    case "DOOR":
      return { width: 2, height: 1 }
    case "BAR":
      return { width: 6, height: 2 }
    case "KITCHEN":
      return { width: 5, height: 4 }
    case "WC":
      return { width: 3, height: 3 }
    case "STAIRS":
      return { width: 2, height: 4 }
    case "PLANT":
      return { width: 1, height: 1 }
    case "SOFA":
      return { width: 4, height: 1 }
    case "FRIDGE":
      return { width: 2, height: 1 }
    case "STAGE":
      return { width: 4, height: 3 }
    default:
      return { width: 4, height: 1 }
  }
}

export type TicketTotals = {
  /** KDV hariç, iskonto ÖNCESİ. */
  net: number
  vat: number
  /** KDV dahil, iskonto öncesi. */
  gross: number
  /** Uygulanan iskonto — KDV DAHİL tutar (ekrandaki rakam). */
  discount: number
  /** Aynı iskontonun matrah (net) karşılığı — fatura `globalDiscountAmount` net bekler. */
  netDiscount: number
  /** Ödenecek tutar. */
  total: number
}

/** Adisyon (hesap) iskontosu. `AMOUNT` KDV DAHİL girilir. */
export type TicketDiscount = { type: "PERCENT" | "AMOUNT"; value: number } | null

export const TICKET_DISCOUNT_TYPES = ["PERCENT", "AMOUNT"] as const

/** Prisma kaydından iskonto okur; tanımsız/bozuk değer iskontosuz sayılır. */
export function ticketDiscountOf(ticket: {
  discountType?: string | null
  discountValue?: unknown
}): TicketDiscount {
  const type = ticket.discountType
  const value = Number(ticket.discountValue ?? 0)
  if ((type !== "PERCENT" && type !== "AMOUNT") || !Number.isFinite(value) || value <= 0) return null
  return { type, value }
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/**
 * İskontonun KDV DAHİL tutar karşılığı. Yüzde hesabın oranı, tutar ise doğrudan
 * kendisidir; ikisi de hesabı AŞAMAZ (kırpılır).
 *
 * Ayrı fonksiyon çünkü iki soruyu aynı kural cevaplamalı: "hesap kaça iniyor"
 * (ticketTotals) ve "bu iskonto tavanı aşıyor mu" (lib/restoran/discount-limit).
 * İkisi ayrı yazılsaydı tavan, ekranda görünenden başka bir rakamı ölçerdi.
 */
export function grossDiscountOf(discount: TicketDiscount, gross: number): number {
  if (!discount || !(gross > 0)) return 0
  return discount.type === "PERCENT"
    ? gross * (Math.min(100, Math.max(0, discount.value)) / 100)
    : Math.min(discount.value, gross)
}

/**
 * Adisyon toplamı. Kalem `unitPrice`'ı NET olduğu için KDV burada eklenir —
 * ekranda gösterilen tutar brüttür (kahveci ekranındaki `grossPrice` ile aynı
 * kural). Fişin kesin toplamı yine SUNUCUDA fatura ucunda hesaplanır; bu değer
 * ekranda gösterim ve kapanış öncesi kontrol içindir.
 *
 * **Yalnız `NORMAL` kalemler sayılır**: ikram 0,00'dır, zayi ve iptal hesapta
 * yoktur. Durumu olmayan (eski) kalem NORMAL sayılır — geriye dönük uyumluluk.
 *
 * İskonto KDV DAHİL uygulanır (kullanıcı hesabın altındaki rakama bakar), ama
 * faturaya matrah karşılığı gider: `netDiscount = discount * net/gross`. Fatura
 * ucu matrahtan oransal düşüp KDV'yi de aynı oranda azalttığı için iki taraf
 * aynı sonucu verir.
 */
export function ticketTotals(
  items: Array<{ quantity: unknown; unitPrice: unknown; vatRate: unknown; status?: string | null }>,
  discount: TicketDiscount = null,
): TicketTotals {
  let net = 0
  let vat = 0
  for (const item of items) {
    if (!isBillableItem(item.status)) continue
    const lineNet = Number(item.quantity) * Number(item.unitPrice)
    net += lineNet
    vat += lineNet * (Number(item.vatRate) / 100)
  }
  const gross = net + vat

  const discountGross = grossDiscountOf(discount, gross)
  const netDiscount = gross > 0 ? discountGross * (net / gross) : 0

  return {
    net: round2(net),
    vat: round2(vat),
    gross: round2(gross),
    discount: round2(discountGross),
    netDiscount: round2(netDiscount),
    total: round2(gross - discountGross),
  }
}
