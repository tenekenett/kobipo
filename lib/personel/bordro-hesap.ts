/**
 * Brüt ↔ net ücret çevrimi (Türkiye, ücretli çalışan).
 *
 * NEDEN GEREKLİ: küçük işletme çalışanla NET üzerinden anlaşır ("eline 40 bin
 * geçecek"), bordro ve SGK ise BRÜT ister. İkisi arasındaki köprü elle
 * kurulduğunda personel kartına yanlış rakam giriyor, maliyet ve puantaj
 * raporları da onunla birlikte kayıyordu.
 *
 * ÇEVRİM TEK YÖNLÜ DEĞİLDİR: brütten net doğrudan hesaplanır, netten brüt için
 * kapalı formül yoktur (gelir vergisi dilimli + asgari ücret istisnası kırıklı
 * bir fonksiyon üretir). Bu yüzden ters yön ARAMA ile çözülür — fonksiyon
 * brütte monoton arttığı için ikili arama kuruşta yakınsar.
 *
 * KÜMÜLATİF MATRAH: gelir vergisi yıl başından beri biriken matrahtan hesaplanır;
 * aynı brüt, Ocak'ta ve Kasım'da FARKLI net verir (dilim yükselir). Bu yüzden her
 * hesap bir AY ister. Personel kartındaki "net" alanı bu nedenle bir sözleşme
 * rakamıdır, her ayın kesin neti değil — ekranlar bunu yazıyla söyler.
 *
 * PARAMETRELER YILLIKTIR ve elle güncellenir (aşağıdaki tablo). Bilinen en son
 * yıla düşülür; hangi yılın parametresiyle hesaplandığı sonuçta `paramYear` ile
 * döner ve ekranda GÖSTERİLİR — sessizce eski tarifeyle hesaplamak, kullanıcının
 * göremediği bir hatadır.
 */

export type BordroParam = {
  year: number
  /** Asgari ücret brüt (aylık). SGK tavanı ve asgari ücret istisnası buradan türer. */
  minGross: number
  /** SGK matrah tavanı = asgari ücretin bu katı. */
  ceilingFactor: number
  /** SGK işçi payı (%14). */
  sgkEmployeeRate: number
  /** İşsizlik sigortası işçi payı (%1). */
  unemploymentEmployeeRate: number
  /** SGK işveren payı (%20,75) — bilgi amaçlı işveren maliyeti için. */
  sgkEmployerRate: number
  /** İşsizlik sigortası işveren payı (%2). */
  unemploymentEmployerRate: number
  /** Damga vergisi oranı (binde 7,59). */
  stampRate: number
  /** Ücret gelir vergisi tarifesi: kümülatif matrah dilimleri. */
  brackets: { upTo: number; rate: number }[]
}

/**
 * Yıllık parametreler — YENİ YIL AÇILDIĞINDA BURAYA EKLENİR.
 *
 * Asgari ücret, gelir vergisi tarifesi ve SGK tavanı her yıl değişir. Tablo
 * güncellenmezse hesap bir önceki yılın tarifesiyle yapılır ve sonuç `paramYear`
 * ile "hangi yıl" diye söyler; ekran bunu kullanıcıya yazar.
 */
export const BORDRO_PARAMS: BordroParam[] = [
  {
    year: 2025,
    minGross: 26005.5,
    ceilingFactor: 7.5,
    sgkEmployeeRate: 0.14,
    unemploymentEmployeeRate: 0.01,
    sgkEmployerRate: 0.2075,
    unemploymentEmployerRate: 0.02,
    stampRate: 0.00759,
    brackets: [
      { upTo: 158_000, rate: 0.15 },
      { upTo: 330_000, rate: 0.2 },
      { upTo: 1_200_000, rate: 0.27 },
      { upTo: 4_300_000, rate: 0.35 },
      { upTo: Infinity, rate: 0.4 },
    ],
  },
]

/** İstenen yıl için tanımlı EN YENİ parametre (yoksa tablodaki en yenisi). */
export function bordroParam(year?: number): BordroParam {
  const sorted = [...BORDRO_PARAMS].sort((a, b) => b.year - a.year)
  if (year != null) {
    const match = sorted.find((p) => p.year <= year)
    if (match) return match
  }
  return sorted[0]
}

export type BordroInput = {
  /** Hesabın yapıldığı yıl — parametre tablosunu seçer. */
  year?: number
  /** 1–12. Kümülatif matrahın kaçıncı aya geldiğini belirler. */
  month?: number
  /**
   * Yıl başından bu aya kadar biriken gelir vergisi MATRAHI. Verilmezse
   * "personel yıl başından beri aynı brütle çalışıyor" varsayılır — personel
   * kartındaki sözleşme rakamı için doğru varsayım budur.
   */
  cumulativeBase?: number
  /**
   * Asgari ücret gelir vergisi + damga vergisi istisnası uygulansın mı?
   * 2022'den beri TÜM ücretlilere uygulanır; kapatma seçeneği yalnızca istisnadan
   * yararlanamayan özel durumlar için var.
   */
  minWageExemption?: boolean
}

export type BordroSonuc = {
  gross: number
  net: number
  sgkEmployee: number
  unemploymentEmployee: number
  incomeTax: number
  stampTax: number
  /** Asgari ücret istisnası nedeniyle DÜŞÜLEN vergi (gelir + damga). */
  exemption: number
  /** Toplam işçi kesintisi (SGK + işsizlik + gelir + damga). */
  totalDeduction: number
  /** İşverene maliyeti (brüt + işveren payları) — bilgi amaçlı. */
  employerCost: number
  /** Hesabın kullandığı parametre yılı; ekranda gösterilir. */
  paramYear: number
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

/** Kümülatif matraha uygulanan toplam gelir vergisi (tarifenin integrali). */
function tariffTotal(base: number, brackets: BordroParam["brackets"]): number {
  let tax = 0
  let previous = 0
  for (const b of brackets) {
    if (base <= previous) break
    const slice = Math.min(base, b.upTo) - previous
    tax += slice * b.rate
    previous = b.upTo
  }
  return tax
}

/** İki kümülatif nokta arasındaki (yani bu ayın) gelir vergisi. */
const tariffBetween = (from: number, to: number, brackets: BordroParam["brackets"]) =>
  Math.max(0, tariffTotal(to, brackets) - tariffTotal(from, brackets))

/**
 * BRÜT → NET.
 *
 * Sıra mevzuattaki sırayla aynıdır ve değiştirilemez: SGK+işsizlik brütten
 * düşülür, gelir vergisi KALAN matrahtan hesaplanır, damga vergisi ise brütün
 * kendisinden. Asgari ücret istisnası en sonda ve iki vergiye AYRI AYRI uygulanır
 * (biri diğerinin artığını yemez).
 */
export function brutenNete(gross: number, input: BordroInput = {}): BordroSonuc {
  const p = bordroParam(input.year)
  const g = Math.max(0, Number(gross) || 0)
  const month = Math.min(12, Math.max(1, Math.round(input.month ?? 1)))
  const exemptionOn = input.minWageExemption !== false

  // SGK matrahı tavanla sınırlıdır (asgari ücretin 7,5 katı); tavan üstü kazançtan
  // prim alınmaz ama gelir vergisi matrahına tam girer.
  const ceiling = p.minGross * p.ceilingFactor
  const sgkBase = Math.min(g, ceiling)
  const sgkEmployee = sgkBase * p.sgkEmployeeRate
  const unemploymentEmployee = sgkBase * p.unemploymentEmployeeRate

  const monthlyBase = Math.max(0, g - sgkEmployee - unemploymentEmployee)
  // Kümülatif verilmediyse "yıl başından beri aynı ücret" varsayılır: sözleşme
  // rakamının hangi aya denk geldiği ancak böyle anlamlı olur.
  const cumulative =
    input.cumulativeBase != null
      ? Math.max(0, input.cumulativeBase)
      : monthlyBase * (month - 1)
  const incomeTaxRaw = tariffBetween(cumulative, cumulative + monthlyBase, p.brackets)
  const stampRaw = g * p.stampRate

  // İstisna: aynı ayda asgari ücretlinin ödeyeceği gelir + damga vergisi kadarı
  // herkesten düşülür. İKİ VERGİYE AYRI AYRI uygulanır — tek bir toplam olarak
  // düşülseydi damga istisnasının artığı gelir vergisini de yer, üst dilimdeki
  // çalışanda vergi olduğundan düşük çıkardı.
  //
  // Asgari ücretin kümülatifi kendi matrahından yürür: asgari ücretli de yıl
  // içinde dilim atlar ve istisna tutarı o tarifeye göre değişir.
  const minSgk = p.minGross * (p.sgkEmployeeRate + p.unemploymentEmployeeRate)
  const minMonthlyBase = Math.max(0, p.minGross - minSgk)
  const minIncomeTax = exemptionOn
    ? tariffBetween(minMonthlyBase * (month - 1), minMonthlyBase * month, p.brackets)
    : 0
  const minStamp = exemptionOn ? p.minGross * p.stampRate : 0

  // İstisna kendi vergisini aşamaz: asgari ücretin altındaki ücrette negatif
  // vergi (yani işverene ödeme) doğurmaz.
  const incomeExempt = Math.min(incomeTaxRaw, minIncomeTax)
  const stampExempt = Math.min(stampRaw, minStamp)
  const incomeTax = incomeTaxRaw - incomeExempt
  const stampTax = stampRaw - stampExempt
  const appliedExemption = incomeExempt + stampExempt

  const totalDeduction = sgkEmployee + unemploymentEmployee + incomeTax + stampTax
  const employerCost =
    g + sgkBase * (p.sgkEmployerRate + p.unemploymentEmployerRate)

  return {
    gross: round2(g),
    net: round2(g - totalDeduction),
    sgkEmployee: round2(sgkEmployee),
    unemploymentEmployee: round2(unemploymentEmployee),
    incomeTax: round2(incomeTax),
    stampTax: round2(stampTax),
    exemption: round2(appliedExemption),
    totalDeduction: round2(totalDeduction),
    employerCost: round2(employerCost),
    paramYear: p.year,
  }
}

/**
 * NET → BRÜT.
 *
 * Kapalı formül YOK: gelir vergisi dilimli, asgari ücret istisnası kırıklı ve SGK
 * tavanı fonksiyonun eğimini üç kez değiştirir. Net brüte göre monoton arttığı
 * için ikili arama kuruş hassasiyetinde ve dilim geçişlerinde de doğru sonuç verir
 * (formülle çözülseydi her dilim için ayrı bir tersleme yazmak gerekirdi).
 */
export function nettenBrute(net: number, input: BordroInput = {}): BordroSonuc {
  const target = Math.max(0, Number(net) || 0)
  if (target === 0) return brutenNete(0, input)

  let low = target
  // Üst sınır: en yüksek dilim %40 + SGK/damga → brüt hiçbir zaman netin 2,5
  // katını aşmaz. Yine de güvenli tarafta kalmak için genişletilerek aranıyor.
  let high = target * 2.5
  let guard = 0
  while (brutenNete(high, input).net < target && guard++ < 40) high *= 1.5

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    if (brutenNete(mid, input).net < target) low = mid
    else high = mid
  }
  // Kuruşa yuvarlanmış brütle YENİDEN hesaplanır: ekranda gösterilen brüt ile
  // gösterilen net aynı hesabın iki ucu olsun, arama artığı görünmesin.
  return brutenNete(round2(high), input)
}

/** Günlük yevmiye: brüt / 30 (SGK gün sayısı). Bordro kesintilerinin böleni. */
export const MONTHLY_PAYROLL_DAYS = 30

export const dailyRate = (gross: number | null | undefined): number =>
  gross == null || !(gross > 0) ? 0 : round2(gross / MONTHLY_PAYROLL_DAYS)
