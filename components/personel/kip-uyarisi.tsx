"use client"

/**
 * "Bu takvim firmanızın çalışma düzenine ait değil" şeridi.
 *
 * Menü zaten kipe göre takvimleri çiziyor; buraya yer imiyle, eski bir linkle ya
 * da adres çubuğundan gelinir. Ekranı KİLİTLEMİYORUZ — kayıtlar duruyor ve
 * kullanıcı bilerek bakıyor olabilir (kip değiştirmiş, eski haftaya bakıyor);
 * yalnız nerede olduğunu ve doğru ekranın nerede olduğunu söylüyoruz.
 *
 * KARMA işletmede şerit HİÇ çıkmaz: orada iki takvim de firmanın kendi ekranıdır.
 */

import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { Info } from "lucide-react"
import { normalizeMode, wrongCalendarScreen } from "@/lib/personel/kip"

export function KipUyarisi({ ekran }: { ekran: "vardiya" | "devam" }) {
  const { selectedCompany } = useDashboardCompany()
  // Kural saf fonksiyonda: firma listesi henüz yüklenmemişken (mode null) uyarı
  // çıkmaması bu ekranda GÖRÜLEN bir hataydı, testi de orada duruyor.
  if (!wrongCalendarScreen(ekran, normalizeMode(selectedCompany?.workScheduleMode))) return null

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
      <Info className="h-4 w-4 shrink-0" />
      {ekran === "vardiya" ? (
        <>
          <span>Firmanız &quot;herkes aynı saatlerde&quot; olarak ayarlı; günlük devam
          işaretlemesi bu ekranda değil.</span>
          <CompanyLink href="/personel/devam" className="font-medium underline underline-offset-4">
            Devam Takvimi&apos;ne git
          </CompanyLink>
        </>
      ) : (
        <>
          <span>Firmanız vardiyalı çalışma olarak ayarlı; bordroya giden puantaj vardiya
          takviminden hesaplanıyor.</span>
          <CompanyLink href="/personel/vardiya" className="font-medium underline underline-offset-4">
            Vardiya Takvimi&apos;ne git
          </CompanyLink>
        </>
      )}
    </div>
  )
}
