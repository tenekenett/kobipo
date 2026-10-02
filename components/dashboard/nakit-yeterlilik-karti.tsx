import Link from "next/link"
import { ArrowUpRight, Hourglass } from "lucide-react"
import { cn } from "@/lib/utils"
import { EN_AZ_GOZLEM_GUN, type NakitYeterlilik } from "@/lib/raporlar/nakit-yeterlilik-hesap"

/**
 * Panodaki "Nakit kaç gün yeter" kartı.
 *
 * RAKAM NAKİT AKIŞI RAPORUYLA AYNI YERDEN GELİR (`computeNakitYeterlilik` →
 * `computeCashFlow`); kartın kendi sorgusu yok, sayfa sonucu hazır verir. Kart
 * tıklanınca o raporu (projeksiyonuyla birlikte) açar.
 *
 * Gün yalnız ölçü anlamlıysa yazılır (kurallar `nakit-yeterlilik-hesap.ts`te);
 * aksi halde sebep yazılır — boş kart ya da yanıltıcı bir sayı değil.
 */

const tl = (n: number) =>
  `${n < 0 ? "−" : ""}₺${Math.abs(n).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function anaSatir(r: NakitYeterlilik): { metin: string; sinif: string } {
  if (r.durum === "nakit-yok") return { metin: "Nakit yok", sinif: "text-orange-700 dark:text-orange-400" }
  if (r.durum !== "hesaplandi" || r.gun == null) return { metin: "—", sinif: "text-kobipo-gray" }
  if (r.ustSinirdaAsti) return { metin: "1 yıldan uzun", sinif: "text-kobipo-green-dark dark:text-emerald-400" }
  const sinif =
    r.gun < 30
      ? "text-orange-700 dark:text-orange-400"
      : r.gun < 60
        ? "text-amber-700 dark:text-amber-400"
        : "text-kobipo-navy dark:text-foreground"
  return { metin: `≈ ${r.gun.toLocaleString("tr-TR")} gün`, sinif }
}

function aciklama(r: NakitYeterlilik): string | null {
  switch (r.durum) {
    case "nakit-yok":
      return "Kayıtlara göre kasa, banka ve kredi kartı toplamı sıfır ya da eksi. Bu çoğu zaman girilmemiş bir tahsilattır; hesap hareketlerini kontrol edin."
    case "gecmis-kisa":
      return r.gozlemGun === 0
        ? "Henüz kasa ya da banka hareketi yok; ödemeler kaydedildikçe hesaplanır."
        : `Kasa hareketleri ${r.gozlemGun} gündür kaydediliyor; ortalama için en az ${EN_AZ_GOZLEM_GUN} gün gerekiyor.`
    case "cikis-az":
      return r.cikisAdedi === 0
        ? `Son ${r.gozlemGun} günde hiç ödeme ya da gider kaydı yok; kaydedildikçe hesaplanır.`
        : `Son ${r.gozlemGun} günde yalnız ${r.cikisAdedi} ödeme/gider kaydı var; ortalama çıkarmak için az. Ödemeler Kobipo'ya girildikçe hesaplanır.`
    default:
      return null
  }
}

export function NakitYeterlilikKarti({ veri, raporHref }: { veri: NakitYeterlilik; raporHref: string }) {
  const ana = anaSatir(veri)
  const not = aciklama(veri)

  return (
    <div className="rounded-3xl border border-kobipo-border/90 bg-card p-6 shadow-card animate-fade-up [animation-delay:150ms]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-kobipo-pale p-2.5 text-kobipo-blue">
            <Hourglass className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">Nakit kaç gün yeter</h2>
            <p className="text-sm text-kobipo-gray">Hiç tahsilat gelmezse</p>
          </div>
        </div>
        <Link
          href={raporHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-kobipo-blue hover:underline"
        >
          Rapor
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <p className={cn("mt-4 font-mono text-2xl font-bold tracking-tight", ana.sinif)}>{ana.metin}</p>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs min-[360px]:grid-cols-2">
        <div className="rounded-xl bg-kobipo-offwhite px-3 py-2 dark:bg-muted/40">
          <p className="font-medium text-kobipo-gray">Mevcut nakit</p>
          <p
            className={cn(
              "font-mono text-sm font-semibold",
              veri.nakit < 0 ? "text-orange-700 dark:text-orange-400" : "text-kobipo-navy dark:text-foreground",
            )}
          >
            {tl(veri.nakit)}
          </p>
        </div>
        <div className="rounded-xl bg-kobipo-offwhite px-3 py-2 dark:bg-muted/40">
          <p className="font-medium text-kobipo-gray">Aylık ortalama çıkış</p>
          <p className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">
            {veri.gozlemGun > 0 ? tl(veri.aylikCikis) : "—"}
          </p>
        </div>
      </div>

      {veri.krediKarti < 0 && (
        <p className="mt-2 text-xs text-kobipo-gray">
          Kredi kartı borcu ({tl(veri.krediKarti)}) nakitten düşülmüş hâliyle.
        </p>
      )}

      {not && (
        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {not}
        </p>
      )}

      {veri.gozlemGun > 0 && (
        <p className="mt-3 border-t border-kobipo-border/60 pt-3 text-[11px] leading-snug text-kobipo-gray">
          Son {veri.gozlemGun} günün ödeme ve gider ortalamasıyla (virmanlar hariç); aynı dönemde aylık ortalama giriş{" "}
          {tl(veri.aylikGiris)}. Vadeli alacak ve borçlar hesaba girmez — onlar için rapordaki nakit projeksiyonuna bakın.
        </p>
      )}
    </div>
  )
}
