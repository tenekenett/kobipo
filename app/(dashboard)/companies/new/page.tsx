import { redirect } from "next/navigation"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getAccountQuotas } from "@/lib/billing/entitlements"
import { NewCompanyForm } from "@/components/dashboard/new-company-form"

export const dynamic = "force-dynamic"

/**
 * Firma/şube oluşturma ekranının KAPISI.
 *
 * Kota denetimi sunucuda, form çizilmeden önce yapılır. Butonu gizlemek yetmiyor:
 * bu sayfaya firma seçicideki "Yeni firma ekle", Firma ve Şube Yönetimi'ndeki butonlar,
 * yer imi ya da elle yazılan URL ile de gelinebiliyor. Kota yoksa kullanıcı boş bir form
 * doldurup en sonda 402 yemek yerine, durumu gördüğü sayfaya yönlendirilir.
 *
 * Kotanın kendisini bu sayfa korumaz — son söz `POST /api/companies`'dedir
 * ([[lib/company/create-company.ts]]). Buradaki kontrol yalnız kullanıcıyı çıkmaz
 * sokağa sokmamak içindir, bu yüzden aynı fonksiyonu okur: `getAccountQuotas`.
 */
export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; parent?: string; company?: string; account?: string }>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect("/signin")

  const isBranch = params.mode === "branch"
  // Şube: ?parent= (yoksa aktif firma ?company=). Ek firma: ?account=.
  const contextParam = isBranch ? params.parent || params.company : params.account
  const contextCompanyId = await resolveCompanyId(contextParam ?? null)

  if (contextCompanyId) {
    // Erişimi olmayan bir firmanın kotasını okumasın; hakkı yoksa kendi bağlamına döner.
    try {
      await ensureCompanyAccess(contextCompanyId)
    } catch {
      redirect("/ayarlar/subeler")
    }

    const quotas = await getAccountQuotas(contextCompanyId)
    const status = isBranch ? quotas.branch : quotas.company
    if (!status.canAdd) {
      // `quota` param'ı hedef sayfada nedeni açıkça yazan şeridi çizer. "Aboneliği yok"
      // ile "kotası dolu" AYRI mesajlardır: ikisini birleştirmek, hiç abonelik almamış
      // kullanıcıya "kotanız dolu" demek olurdu — yanlış bilgi, yanlış çözüm.
      const reason = !status.hasActiveSubscription
        ? "subscription"
        : isBranch
          ? "branch"
          : "company"
      redirect(
        `/ayarlar/subeler?company=${encodeURIComponent(contextParam ?? "")}&quota=${reason}`,
      )
    }
  } else if (!isBranch) {
    // Bağlamsız açılış = "ilk firma" akışı. Kendi hesabı olan kullanıcı buraya
    // düşmemeli: ikinci firmasını ek firma olarak (hesaba bağlı, kotadan) açar.
    // Sunucu bunu zaten ACCOUNT_REQUIRED ile reddediyor; kullanıcıyı formu doldurup
    // hata almadan önce doğru yere gönderiyoruz.
    const ownedRoot = await prisma.userCompany.findFirst({
      where: {
        userId: user.id,
        role: "ADMIN",
        company: { parentCompanyId: null, accountRootId: null },
      },
      orderBy: { createdAt: "asc" },
      select: { company: { select: { slug: true } } },
    })
    if (ownedRoot) {
      redirect(
        `/ayarlar/subeler?company=${encodeURIComponent(ownedRoot.company.slug)}&quota=account`,
      )
    }
  }

  return <NewCompanyForm />
}
