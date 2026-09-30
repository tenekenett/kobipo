import Link from "next/link"
import { ArrowUpRight, Landmark } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SiradakiBeyan } from "@/lib/otomasyon/veri/kdv-donemi"

/**
 * Panodaki KDV durumu — sıradaki beyanın dönemi, farkı ve son günü.
 *
 * RAKAM VERGİ RAPORUYLA AYNI YERDEN GELİR (`computeVatDeclaration`): kart
 * tıklanınca o raporu aynı dönemle açar, iki ekran iki rakam göstermemeli.
 * Bu yüzden kartın kendi sorgusu yok; sayfa sonucu hazır verir.
 *
 * Kart bir beyanname DEĞİLDİR: önceki dönemden devreden KDV, tevkifat ve
 * istisna hesaba girmez. Bu kartın kendi cümlesinde yazılı — "ödenecek KDV"
 * diye çıplak bir rakam beyanname yerine konabilirdi.
 */

export type KdvTutarlari = {
  hesaplanan: number
  indirilecek: number
  net: number
  /** Kuru girilmemiş dövizli belge — TL'ye çevrilemedi, toplamda YOK. */
  kursuzDovizli: number
}

const tl = (n: number) =>
  `₺${Math.abs(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function kalanMetni(kalanGun: number) {
  if (kalanGun === 0) return "bugün son gün"
  return `${kalanGun} gün kaldı`
}

function farkSatiri(net: number) {
  if (net > 0) return { etiket: "Ödenecek", sinif: "text-orange-700 dark:text-orange-400" }
  if (net < 0) return { etiket: "Sonraki aya devreden", sinif: "text-kobipo-green-dark dark:text-emerald-400" }
  return { etiket: "KDV farkı yok", sinif: "text-kobipo-navy dark:text-foreground" }
}

export function KdvDurumuKarti({
  beyan,
  donem,
  buAy,
  raporHref,
}: {
  beyan: SiradakiBeyan
  donem: KdvTutarlari
  /** Dönem geçen aysa içinde bulunulan ayın gidişatı; değilse null. */
  buAy: KdvTutarlari | null
  raporHref: string
}) {
  const fark = farkSatiri(donem.net)
  const yakin = beyan.kalanGun <= 7

  return (
    <div className="rounded-3xl border border-kobipo-border/90 bg-card p-6 shadow-card animate-fade-up [animation-delay:140ms]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-kobipo-pale p-2.5 text-kobipo-blue">
            <Landmark className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">KDV durumu</h2>
            <p className="text-sm text-kobipo-gray">{beyan.donemAdi} dönemi</p>
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

      <p
        className={cn(
          "mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
          yakin
            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            : "bg-kobipo-pale text-kobipo-navy dark:bg-muted dark:text-foreground",
        )}
      >
        Son beyan ve ödeme {beyan.beyanTarihi} · {kalanMetni(beyan.kalanGun)}
      </p>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">{fark.etiket}</p>
        <p className={cn("mt-1 font-mono text-2xl font-bold tracking-tight", fark.sinif)}>
          {tl(donem.net)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs min-[360px]:grid-cols-2">
        <div className="rounded-xl bg-kobipo-offwhite px-3 py-2 dark:bg-muted/40">
          <p className="font-medium text-kobipo-gray">Hesaplanan</p>
          <p className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">{tl(donem.hesaplanan)}</p>
        </div>
        <div className="rounded-xl bg-kobipo-offwhite px-3 py-2 dark:bg-muted/40">
          <p className="font-medium text-kobipo-gray">İndirilecek</p>
          <p className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">{tl(donem.indirilecek)}</p>
        </div>
      </div>

      {donem.kursuzDovizli > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {donem.kursuzDovizli} dövizli faturanın kuru girilmemiş; TL&apos;ye çevrilemediği için bu rakama dahil değil.
        </p>
      )}

      {beyan.devamEdiyor ? (
        <p className="mt-3 text-xs text-kobipo-gray">Dönem devam ediyor; rakam ay sonuna kadar değişir.</p>
      ) : buAy ? (
        <p className="mt-3 text-xs text-kobipo-gray">
          {beyan.buAy.adi} şu ana kadar:{" "}
          <span className="font-mono font-semibold text-kobipo-text">
            {buAy.net < 0 ? `${tl(buAy.net)} devreden` : `${tl(buAy.net)} ödenecek`}
          </span>
        </p>
      ) : null}

      <p className="mt-3 border-t border-kobipo-border/60 pt-3 text-[11px] leading-snug text-kobipo-gray">
        Faturalardan hesaplanır; önceki dönemden devreden KDV, tevkifat ve istisnalar dahil değildir. Beyanname yerine geçmez.
      </p>
    </div>
  )
}
