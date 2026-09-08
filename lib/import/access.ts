import { assertPagePath } from "@/lib/middleware/company"
import { importTargetApiPath } from "@/lib/page-access"
import type { UserCompanyContext } from "@/lib/auth/user-context"

/**
 * İçe aktarmanın YETKİ kapısı: aktarım hedef ekranın yetkisini de ister.
 *
 * `/api/import` tek bir uçtur ama ne yazacağını yolda değil `module` alanında taşır —
 * tıpkı `/api/export?module=products` gibi. Sayfa kapısı ucun kendi yolundan türediği
 * için (`/api/import` → `/ayarlar/veri-aktarim`) aktarım, yazdığı verinin sahibini
 * atlıyordu: "Müşteri" sayfası salt-okunur yapılmış bir çalışan veri aktarım
 * ekranından cari listesi yükleyerek müşteri EKLEYEBİLİYORDU. Ve o sayfa SALES
 * rolünün varsayılan matrisinde olduğu için kapı pratikte hiç kapanmıyordu.
 *
 * Aktarım bir TAŞIMA aracıdır, yetki devretmez: yazdığı veriye kim dokunabiliyorsa
 * onu aktarabilir. Hedef eşlemesi `lib/page-access.ts`te ve saf — burada sayfa adı
 * elle yazılmaz.
 */
export async function assertImportTargetWrite(
  context: UserCompanyContext,
  module: string,
): Promise<void> {
  const target = importTargetApiPath(module)
  if (!target) return
  await assertPagePath(context, target, "POST")
}
