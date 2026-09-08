import { assertPagePath } from "@/lib/middleware/company"
import { cariMirrorApiPath, type CariMirror } from "@/lib/page-access"
import type { UserCompanyContext } from "@/lib/auth/user-context"

/**
 * "Aynı zamanda Müşteri / Aynı zamanda Tedarikçi" ikizinin YETKİ kapısı.
 *
 * Cari uçları kendi kartını yazarken karşı tabloya da dokunur: tedarikçiye
 * `isAlsoCustomer` verilince bir `Customer` satırı DOĞAR, geri alınınca SİLİNİR
 * (bkz. app/api/cari/suppliers/[id]/route.ts). Kapı ise ucun kendi yolundan
 * türüyordu — `/api/cari/suppliers` yazması `/cari/tedarikci`ye bağlı — yani
 * "Müşteri" sayfası salt-okunur yapılmış bir çalışan, tedarikçi kartı üzerinden
 * müşteri EKLEYEBİLİYOR ve SİLEBİLİYORDU. Kullanıcının bildirdiği hata buydu.
 *
 * Çözüm `assertModulePath`/`assertPagePath` deseninin aynısı: hedefini kendi
 * yolunda taşımayan bir yazma, karşılık gelen "gerçek" uçtan denetlenir. Sahiplik
 * `PAGE_API_RULES`tan türer; burada `/cari/musteri` gibi bir sayfa adı ELLE yazılmaz.
 *
 * KAPSAM bilinçle KİMLİK değişiklikleriyle sınırlı: ikiz kartın DOĞMASI ve
 * SİLİNMESİ. Zaten bağlı bir çiftte ad/VKN/adres alanlarının aynalanması
 * (`mirrorCustomer` güncellemesi) kapıya alınmadı — o, tek bir gerçek kişinin iki
 * kartını tutarlı tutan bakım işidir; reddedilse iki kart kalıcı olarak ayrışır ve
 * hangisinin doğru olduğu belirsizleşirdi.
 */
export async function assertCariMirrorWrite(
  context: UserCompanyContext,
  mirror: CariMirror,
): Promise<void> {
  await assertPagePath(context, cariMirrorApiPath(mirror), "POST")
}
