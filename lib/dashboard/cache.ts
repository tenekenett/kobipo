// Panonun (dashboard) veri önbelleği — etiket ve geçersiz kılma tek yerde.
//
// Pano sorguları `unstable_cache` ile 20 sn tutuluyor: F5'e basılı tutan bir
// kullanıcı yüzünden aynı toplamlar saniyede onlarca kez hesaplanmasın. Ama
// PARA HAREKET ETTİĞİNDE 20 sn beklemek kabul edilemez — kasiyer satışı yapıp
// panoya baktığında rakamı görmeli.
//
// Çözüm: önbellek firma başına etiketleniyor, para yazan uçlar da o etiketi
// geçersiz kılıyor. Böylece önbellek hem korunuyor hem "anında" oluyor.

import { revalidateTag } from "next/cache"

/** Firma bazlı etiket: bir firmanın satışı diğerinin önbelleğini düşürmesin. */
export const dashboardTag = (companyId: string) => `dashboard:${companyId}`

/**
 * Para/belge yazan uçlardan çağrılır (fatura-fiş oluşturma, tahsilat, iptal,
 * kasa hareketi). Yanıtı geciktirmemesi için hata YUTULUR: önbellek tazeleme
 * yan iştir, başarısız olursa en fazla 20 sn eski veri görünür — yazma işlemi
 * bu yüzden hataya düşmemeli.
 */
export function revalidateDashboard(companyId: string | null | undefined): void {
  if (!companyId) return
  try {
    // `{ expire: 0 }` = ANINDA geçersiz (Next 16'da ikinci argüman zorunlu;
    // verilmezse "deprecated" uyarısı basar). Bekleyen bir profil vermek
    // "satıştan hemen sonra bak" senaryosunu karşılamazdı.
    revalidateTag(dashboardTag(companyId), { expire: 0 })
  } catch (error) {
    console.error("[dashboard] önbellek tazelenemedi:", error)
  }
}
