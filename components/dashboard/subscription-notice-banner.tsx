"use client"

import useSWR from "swr"
import { AlertTriangle, Clock } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"

type NoticeResponse = {
  notice: {
    kind: "expiring" | "expired"
    endsAt: string
    /** Modüllerin gerçekten kapanacağı an; hoşgörü süresi varsa `endsAt`'ten sonradır. */
    locksAt: string
    daysLeft: number
    cancelling: boolean
  } | null
  canPurchase: boolean
}

/**
 * Aboneliğin bitişini panelin üstünde duyurur.
 *
 * Neden var: modüller yalnız satın almayla açılıyor ve bugün hiçbir abonelik otomatik
 * yenilenmiyor (`/api/billing/recurring/run` iskele). Uyarı olmazsa kullanıcı dönem
 * bitiminde sebebini bilmeden boş bir panele düşer. Şerit yalnız BİLGİLENDİRİR —
 * erişimi kesen bir şey yapmaz.
 *
 * Şube seçiliyken de görünür: abonelik hesap (kök firma) düzeyindedir, şubenin erişimi
 * de aynı dönemde biter.
 */
export function SubscriptionNoticeBanner() {
  const { selectedCompany } = useDashboardCompany()
  const companyParam = selectedCompany?.slug ?? selectedCompany?.id ?? null

  const { data } = useSWR<NoticeResponse>(
    companyParam ? `/api/billing/notice?companyId=${encodeURIComponent(companyParam)}` : null,
    // Bitiş tarihi gün ölçeğinde bir bilgi; her gezinmede yeniden sormaya gerek yok.
    { revalidateIfStale: false, dedupingInterval: 5 * 60 * 1000 }
  )

  const notice = data?.notice
  if (!notice) return null

  const expired = notice.kind === "expired"
  const trDate = (iso: string) =>
    new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
  const endsAt = trDate(notice.endsAt)

  const headline = expired
    ? `Aboneliğinizin dönemi ${endsAt} tarihinde doldu`
    : notice.daysLeft === 1
      ? "Aboneliğiniz yarın sona eriyor"
      : `Aboneliğiniz ${notice.daysLeft} gün sonra sona eriyor`

  // NOT — burada "modülleriniz kapanacak" DENMİYOR, çünkü bugün kapanmıyor: süresi
  // dolanı kilitleyen günlük iş (`/api/billing/cron/daily`) yazıldı ama ZAMANLANMADI
  // (bkz. docs/paket-abonelik/MODUL-KILIDI.md → "Bitiş/yenileme"). Olmayan bir kesintiyi
  // duyurmak kullanıcıyı boşuna telaşlandırır. Cron açıldığında kapanış tarihini
  // (`notice.locksAt`) söyleyen cümle buraya geri gelmeli.
  const detail = data?.canPurchase
    ? expired
      ? "Erişiminiz şu an devam ediyor. Yeni bir dönem başlatmak için aboneliğinizi yenileyebilirsiniz."
      : "Kesintisiz devam etmek için aboneliğinizi yenileyebilirsiniz. Otomatik yenileme henüz devrede değil, yenilemeyi siz başlatmalısınız."
    : "Yenileme yetkisi firma yöneticisindedir; dilerseniz yöneticinizi bilgilendirin."

  const tone = expired
    ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"

  const Icon = expired ? AlertTriangle : Clock

  return (
    <div
      className={`mb-4 flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">{headline}</p>
          <p className="mt-0.5 opacity-90">{detail}</p>
        </div>
      </div>

      {data?.canPurchase && (
        <CompanyLink
          href="/ayarlar/abonelik"
          className="shrink-0 self-start rounded-lg bg-kobipo-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 sm:self-auto"
        >
          Aboneliği yenile
        </CompanyLink>
      )}
    </div>
  )
}
