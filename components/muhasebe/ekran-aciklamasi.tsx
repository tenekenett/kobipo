"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Muhasebe ekranlarının "Bu ekran ne işe yarar?" kutusu — muhasebeci olmayan kullanıcı
 * için düz dille. İlk açılışta açık durur; kapatılınca tarayıcı hatırlar (yalnız
 * görünüm tercihi, kaybolursa yine açık gelir).
 */
export function EkranAciklamasi({ anahtar, children, baslik = "Bu ekran ne işe yarar?" }: { anahtar: string; children: ReactNode; baslik?: string }) {
  const depo = `muhasebe-aciklama:${anahtar}`
  const [acik, setAcik] = useState(true)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(depo) === "kapali") setAcik(false)
    } catch {
      /* depolama yoksa açık kalır */
    }
  }, [depo])
  const degistir = () => {
    setAcik((a) => {
      try {
        window.localStorage.setItem(depo, a ? "kapali" : "acik")
      } catch {
        /* yok say */
      }
      return !a
    })
  }
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/70 text-sm text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-100">
      <button type="button" onClick={degistir} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-semibold" aria-expanded={acik}>
        <HelpCircle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">{baslik}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", acik && "rotate-180")} aria-hidden />
      </button>
      {acik && <div className="space-y-2 px-4 pb-3 leading-relaxed [&_strong]:font-semibold">{children}</div>}
    </div>
  )
}

/**
 * Muhasebe terimleri — özet ekranındaki sözlük ve ekran açıklamaları aynı metni kullanır.
 * Tanım müşavir için değil işletme sahibi için yazılmıştır.
 */
export const MUHASEBE_SOZLUGU: Array<{ terim: string; anlam: string; href?: string }> = [
  {
    terim: "Fiş (yevmiye fişi)",
    anlam:
      "Bir belgenin ya da para hareketinin muhasebe kaydı. Her fişte en az iki satır vardır: bir hesap borçlanır, bir hesap alacaklanır ve iki taraf kuruşu kuruşuna eşittir. Kobipo fişleri belgelerinizden kendisi hazırlar; siz onaylarsınız.",
    href: "/muhasebe/fisler",
  },
  {
    terim: "Hesap planı",
    anlam:
      "Kayıtların yazıldığı hesapların listesi. Türkiye'de herkes aynı numaraları kullanır (Tekdüzen): 100 Kasa, 102 Bankalar, 120 Alıcılar (müşteriler), 320 Satıcılar (tedarikçiler), 600 Satışlar, 770 Genel giderler… Her müşteri ve tedarikçi için alt hesap açılır (120.01.0001 gibi).",
    href: "/muhasebe/hesap-plani",
  },
  {
    terim: "Borç / alacak",
    anlam:
      "Kaydın iki yönü; günlük dildeki borç-alacakla aynı şey değildir. Kasaya para girerse kasa BORÇlanır, müşteri size borçlanınca müşteri hesabı BORÇlanır; satış, borçlar ve sermaye ALACAK tarafında büyür.",
  },
  {
    terim: "Yevmiye defteri",
    anlam: "Onaylanmış bütün fişlerin tarih sırasıyla listesi — defterin kendisi.",
    href: "/muhasebe/yevmiye",
  },
  {
    terim: "Kebir (hesap dökümü)",
    anlam: "Tek bir hesabın bütün hareketleri ve yürüyen bakiyesi; ör. bankanızın ya da bir müşterinizin defterdeki dökümü.",
    href: "/muhasebe/kebir",
  },
  {
    terim: "Mizan",
    anlam:
      "Bütün hesapların toplam borcu, toplam alacağı ve bakiyesi tek tabloda. Toplam borç toplam alacağa eşit olmalıdır — defterin doğru tutulduğunun ilk kontrolüdür.",
    href: "/muhasebe/mizan",
  },
  {
    terim: "Bilanço",
    anlam:
      "Belirli bir gündeki fotoğraf: işletmenin nesi var (kasa, banka, alacaklar, stok) ve bunlar nereden geldi (borçlar ve öz kaynak). İki taraf her zaman eşittir.",
    href: "/muhasebe/mali-tablolar",
  },
  {
    terim: "Gelir tablosu",
    anlam: "Seçilen dönemin filmi: satışlar, satılan malın maliyeti, giderler ve sonunda kâr ya da zarar.",
    href: "/muhasebe/mali-tablolar",
  },
  {
    terim: "Açılış fişi",
    anlam:
      "Defterin başladığı gündeki bakiyeler (müşteri ve tedarikçi bakiyeleri, kasa, banka, çekler). Kobipo'da tutulmayan kalemler (sermaye, demirbaş, stok) muhasebeciniz tarafından eklenir.",
  },
  {
    terim: "Dönem kapanışı",
    anlam:
      "Yıl sonunda gelir ve giderlerin kâra/zarara aktarılması ve yılın kilitlenmesi. Kapanan yılın fişleri artık değiştirilemez.",
    href: "/muhasebe/ayarlar",
  },
]
