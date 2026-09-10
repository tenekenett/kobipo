"use client"

/**
 * Personel modülünün ortak kabuğu — tek işi KURULUM sorusunu bir kez sormak.
 *
 * Soru neden burada: "modül açılışı" tek bir sayfa değil, personel altındaki
 * herhangi bir ekrana ilk giriştir. Tek tek sayfalara konsaydı kullanıcı doğrudan
 * /personel/maas'a girdiğinde soru hiç çıkmaz, menüde ise kendisine uymayan takvim
 * durmaya devam ederdi.
 *
 * Cevap firma ayarına yazılır (`Company.workScheduleMode`) ve firma listesi tazelenir —
 * menü kipi o listeden çizilir, yenilenmezse kullanıcı sayfayı elle yenileyene
 * kadar eski takvimi görür.
 */

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useWriteGuard } from "@/components/dashboard/write-guard"
import { useToast } from "@/components/ui/use-toast"
import { VardiyaKurulumDialog } from "@/components/personel/vardiya-kurulum-dialog"
import { MODE_LABEL, normalizeMode, type WorkScheduleMode } from "@/lib/personel/kip"

/** "Sonra karar vereyim" yalnız bu oturumu susturur; kalıcı cevap firmadadır. */
const ERTELEME_KEY = "personel:vardiya-kurulum-ertelendi"

export default function PersonelLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { selectedCompany, fetchCompanies } = useDashboardCompany()
  const { canWrite } = useWriteGuard()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [ertelendi, setErtelendi] = useState(true)

  // Erteleme sessionStorage'da: sunucuya "kararsız" diye bir üçüncü değer yazmak,
  // aynı soruyu başka bir cihazda hiç sormamak anlamına gelirdi.
  useEffect(() => {
    if (typeof window === "undefined") return
    const key = `${ERTELEME_KEY}:${selectedCompany?.id ?? companyId ?? ""}`
    try {
      setErtelendi(sessionStorage.getItem(key) === "1")
    } catch {
      setErtelendi(false)
    }
  }, [companyId, selectedCompany?.id])

  const ertele = useCallback(() => {
    setErtelendi(true)
    try {
      sessionStorage.setItem(`${ERTELEME_KEY}:${selectedCompany?.id ?? companyId ?? ""}`, "1")
    } catch {
      /* özel sekmede depolama kapalı olabilir; soru bir sonraki gezinmede çıkar */
    }
  }, [companyId, selectedCompany?.id])

  const kaydet = useCallback(
    async (mode: WorkScheduleMode) => {
      if (!companyId) return
      setIsSaving(true)
      try {
        const res = await fetch("/api/personel/ayarlar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, workScheduleMode: mode }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast({
            title: "Kaydedilemedi",
            description: data?.error || "Ayar yazılamadı.",
            variant: "destructive",
          })
          return
        }
        await fetchCompanies()
        toast({
          title: `Çalışma düzeni: ${MODE_LABEL[mode]}`,
          description:
            mode === "MIXED"
              ? "İki takvim de açıldı. Kimin hangi takvimde olduğunu personel kartından seçin."
              : mode === "SHIFT"
                ? "Personel menüsünde Vardiya Takvimi'ni bulacaksınız."
                : "Personel menüsünde Devam Takvimi'ni bulacaksınız.",
        })
      } finally {
        setIsSaving(false)
      }
    },
    [companyId, fetchCompanies, toast],
  )

  // Soru YALNIZ yazma yetkisi olana sorulur: kısıtlı çalışan firmanın çalışma
  // düzenini belirleyemez ve kararı sorulursa ya yanlış cevaplar ya da 403 yer.
  const sor =
    Boolean(companyId) &&
    canWrite &&
    !ertelendi &&
    selectedCompany != null &&
    normalizeMode(selectedCompany.workScheduleMode) === null

  return (
    <>
      {children}
      <VardiyaKurulumDialog open={sor} isSaving={isSaving} onSkip={ertele} onSave={kaydet} />
    </>
  )
}
