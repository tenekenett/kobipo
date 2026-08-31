// Modülsüz ("yalnız kota") siparişin AÇILABİLİR olup olmadığının kuralı — saf, DB'siz.
//
// Neden ayrı bir kapı gerekti: kota siparişi ödeme akışında diğerlerinden farklı
// davranıyor. `planSubscriptionWrite` onu "kota takviyesi" olarak işler — dönemi
// UZATMAZ, modüllere DOKUNMAZ, kotayı DÜŞÜRMEZ. Bu üç "yapmaz" doğru davranış, ama
// birleşince paranın karşılıksız kalabileceği iki delik açıyor:
//
//  1. Kota artmıyorsa: müşteri sahip olduğu kotanın bedelini bir kez daha öder, karşılığında
//     ne yeni kota ne yeni gün alır (takviye dönemi uzatmaz). Tam bir karşılıksız tahsilat.
//  2. Abonelik aktif değilse: kota yükselir ama `getAccountQuotas` aktif olmayan hesapta
//     kotayı 0 sayar (fail-closed). Müşteri ödediği şubeyi yine açamaz.
//
// İkisi de ödeme ALINDIKTAN sonra fark edilir; bu yüzden kapı sipariş AÇILIRKEN durur.
// Kural burada saf duruyor ki ekran ile uç aynı cevabı versin: arayüz düğmeyi kapatır,
// uç 400 döndürür — ikisi ayrışırsa kullanıcı ödeme ekranına gidip hata yer.

export type QuotaOnlyGuardInput = {
  /** Sipariş modülsüz mü? (`resolvedModules` boş ve en az bir kota isteniyor) */
  quotaOnly: boolean
  /** Siparişin isteyeceği TOPLAM kotalar. */
  branchQuota: number
  companyQuota: number
  /**
   * Hesabın mevcut aboneliği. `null` = hiç abonelik satırı yok; o durumda takviye değil
   * yeni satır açılır (kota 0'dan yükselir, `status: ACTIVE` yazılır) ve kural işlemez.
   */
  existing: {
    branchQuota: number
    companyQuota: number
    /** Ücretli-aktif VEYA deneme — `getAccountQuotas` ile AYNI ölçü. */
    active: boolean
  } | null
}

export type QuotaOnlyGuardResult = { ok: true } | { ok: false; error: string }

export function checkQuotaOnlyOrder(input: QuotaOnlyGuardInput): QuotaOnlyGuardResult {
  if (!input.quotaOnly || !input.existing) return { ok: true }

  if (!input.existing.active) {
    return {
      ok: false,
      error:
        "Aboneliğiniz aktif olmadığı için yalnız kota satın alınamaz — satın aldığınız kota " +
        "kullanılamazdı. Önce bir paket ya da modül seçerek aboneliğinizi başlatın.",
    }
  }

  const branchAdded = input.branchQuota - input.existing.branchQuota
  const companyAdded = input.companyQuota - input.existing.companyQuota
  if (branchAdded <= 0 && companyAdded <= 0) {
    return {
      ok: false,
      error:
        `Kotanız zaten bu seviyede (şube ${input.existing.branchQuota}, ek firma ` +
        `${input.existing.companyQuota}). Yalnız kota siparişi dönemi uzatmaz, yani bu ` +
        "ödemenin karşılığı olmaz. Kota eklemek için adedi yükseltin; aboneliğinizi " +
        "yenilemek için paket ya da modül seçin.",
    }
  }

  return { ok: true }
}
