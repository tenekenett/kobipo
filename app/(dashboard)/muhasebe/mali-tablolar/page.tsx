"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Eye, Loader2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { cn } from "@/lib/utils"
import {
  KurulumGerekli,
  Kart,
  SayfaBasligi,
  Uyari,
  gunMetni,
  muhasebeIstegi,
  tutarSifirli,
  useMuhasebeDurumu,
  DurumBekleniyor,
} from "@/components/muhasebe/ortak"
import { DonemSecici, useDonem } from "@/components/muhasebe/donem-secici"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"
import type { Bilanco, GelirTablosuKalemi, TabloBolumu, TabloNotlari } from "@/lib/muhasebe/mali-tablolar"

/**
 * Bilanço ve Gelir Tablosu — muhasebe defterinin (onaylı fişler, mizan) Tekdüzen
 * mali tabloları. Kural: lib/muhasebe/mali-tablolar.ts. Raporlar menüsündeki
 * "Finansal Raporlar" kaynak kayıtlardan kurulur; bu sayfa defterden.
 *
 * Resmî tablo yalnız onaylı fiştir; "Taslaklarla ön izle" (`?taslak=1`) henüz
 * onaylanmamış fişleri de katar. Ekran boş/denk değil/brüt kâr şişkin göründüğünde
 * NEDENİNİ yazar (`notlar`): muhasebeci olmayan kullanıcı bunları hata sanıyordu.
 */

type Yanit = {
  bilanco: Bilanco
  gelirTablosu: { kalemler: GelirTablosuKalemi[]; netKar: number }
  taslakDahil: boolean
  notlar: TabloNotlari
}

const isaretli = (n: number) => (n < 0 ? `(${tutarSifirli(-n)})` : tutarSifirli(n))

export default function MaliTablolarPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = sp.get("company")
  const taslak = sp.get("taslak") === "1"
  const { bas, bit } = useDonem()
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)

  const taslakAyarla = (acik: boolean) => {
    const q = new URLSearchParams(sp.toString())
    if (acik) q.set("taslak", "1")
    else q.delete("taslak")
    router.replace(`${pathname}?${q}`, { scroll: false })
  }

  useEffect(() => {
    if (!companyId || !durum?.kurulu) return
    setYukleniyor(true)
    muhasebeIstegi<Yanit>(`/api/muhasebe/mali-tablolar?${new URLSearchParams({ companyId, bas, bit, ...(taslak ? { taslak: "1" } : {}) })}`)
      .then((v) => {
        setVeri(v)
        setHata(null)
      })
      .catch((e) => setHata(e instanceof Error ? e.message : String(e)))
      .finally(() => setYukleniyor(false))
  }, [companyId, durum?.kurulu, bas, bit, taslak])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  const b = veri?.bilanco
  const n = veri?.notlar
  // Onaylı fiş hiç yokken resmî tablo boştur: boş tabloyu çizmek yerine nedenini söyle.
  const bos = veri && !veri.taslakDahil && n?.onayliFis === 0

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Bilanço ve Gelir Tablosu"
        aciklama="Defterinizden kurulan resmî mali tablolar (Tekdüzen). Bilanço seçilen dönemin son günü itibarıyla, gelir tablosu seçilen dönem için."
      />
      <EkranAciklamasi anahtar="mali-tablolar">
        <p>
          <strong>Bilanço</strong> bir günün fotoğrafıdır: solda işletmenin <em>nesi var</em> (kasa, banka, müşterilerden alacaklar, stok),
          sağda bunların <em>nereden geldiği</em> (tedarikçilere ve devlete borçlar, sermaye ve kâr). İki taraf her zaman eşittir.
        </p>
        <p>
          <strong>Gelir tablosu</strong> dönemin filmidir: satışlardan satılan malın maliyeti ve giderler düşülür, sonunda kâr ya da zarar
          kalır.
        </p>
        <p>
          Rakamlar yalnız <strong>onaylanmış fişlerden</strong> gelir. Henüz onaylamadığınız fişleri de görmek için &quot;Taslaklarla ön
          izle&quot;yi açın. Raporlar menüsündeki <em>Finansal Raporlar</em> ise kayıtlarınızdan (fatura, kasa, cari) anlık kurulur ve
          muhasebe onayı beklemez; ikisi arasındaki fark çoğu zaman onaylanmamış fişlerdir.
        </p>
      </EkranAciklamasi>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DonemSecici />
        <label className="flex items-center gap-2 text-sm text-kobipo-navy dark:text-foreground">
          <input type="checkbox" checked={taslak} onChange={(e) => taslakAyarla(e.target.checked)} />
          Taslaklarla ön izle
        </label>
      </div>
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {yukleniyor && !veri && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor…
        </p>
      )}
      {taslak && (
        <Uyari ton="mavi">
          Ön izleme: onaylanmamış {n?.taslakFis ? `${n.taslakFis} taslak fiş` : "taslak fişler"} de tablolara giriyor. Resmî tablo yalnız onaylı
          fişlerdir.
        </Uyari>
      )}
      {n && !taslak && n.onayliFis > 0 && n.taslakFis > 0 && (
        <Uyari ton="sari">
          {gunMetni(bit)} tarihine kadar {n.taslakFis} fiş henüz onaylanmadı ve tablolara girmiyor.{" "}
          <button type="button" className="font-semibold underline" onClick={() => taslakAyarla(true)}>
            Taslaklarla ön izle
          </button>{" "}
          ya da{" "}
          <CompanyLink href="/muhasebe/fisler" className="font-semibold underline">
            fişleri onaylayın
          </CompanyLink>
          .
        </Uyari>
      )}
      {n?.farkHesapsizdan && n.hesapsiz && (
        <Uyari ton="sari">
          {n.hesapsiz.fisSayisi} taslak fişte hesabı seçilmemiş satırlar var (borç {tutarSifirli(n.hesapsiz.borc)}, alacak{" "}
          {tutarSifirli(n.hesapsiz.alacak)}); bu tutarlar hiçbir hesaba yazılmadığı için tablolara girmedi ve bilanço bu yüzden denk
          görünmüyor. Hesapları{" "}
          <CompanyLink href="/muhasebe/fisler/eslesme" className="font-semibold underline">
            toplu eşleme
          </CompanyLink>{" "}
          ekranından seçince fark kapanır.
        </Uyari>
      )}
      {n?.dengeHatasi && b && (
        <Uyari ton="kirmizi">
          Bilanço denk değil (aktif {tutarSifirli(b.aktifToplam)} ≠ pasif {tutarSifirli(b.pasifToplam)}) ve fark hesabı seçilmemiş satırlardan
          gelmiyor. Bu bir hatadır; destek ekibine bildirin.
        </Uyari>
      )}
      {n?.smmEksik && (
        <Uyari ton="mavi">
          <strong>Satılan malın maliyeti henüz hesaplanmadı.</strong> Aldığınız mallar ({tutarSifirli(n.smmEksik.stok)} ₺) Ticari Mallar (153)
          hesabında stok olarak duruyor; sattıklarınızın maliyeti gider olarak yazılmadıkça <em>brüt kâr</em> olduğundan yüksek görünür.{" "}
          <CompanyLink href="/muhasebe/ay-sonu" className="font-semibold underline">
            Ay Sonu İşlemleri
          </CompanyLink>
          &apos;nden her ayın maliyetini yazın (stok takibi yapmıyorsanız yıl sonu sayımıyla dönem kapanışında hesaplanır).
        </Uyari>
      )}
      {b && b.kapanmamisSonuc !== 0 && !bos && (
        <p className="text-xs text-kobipo-gray">
          Dönem kapanışı yapılmadığı için gelir ve giderlerin farkı ({isaretli(b.kapanmamisSonuc)}) öz kaynaklarda &quot;kapanmamış&quot;
          satırında duruyor; kapanışta 590/591 hesabına aktarılır.
        </p>
      )}

      {bos && (
        <Kart className="space-y-3">
          <p className="font-semibold text-kobipo-navy dark:text-foreground">Henüz onaylanmış fiş yok</p>
          <p className="text-sm text-kobipo-gray">
            Resmî tablolar yalnız onaylanmış fişlerden kurulur.
            {n && n.taslakFis > 0 && ` ${n.taslakFis} taslak fiş onayınızı bekliyor.`} Taslakları onaylamadan nasıl görüneceğine bakmak için ön
            izlemeyi açabilirsiniz.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => taslakAyarla(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-kobipo-blue px-3 py-2 text-sm font-semibold text-white hover:bg-kobipo-blue/90"
            >
              <Eye className="h-4 w-4" /> Taslaklarla ön izle
            </button>
            <CompanyLink
              href="/muhasebe/fisler"
              className="rounded-xl border border-kobipo-border px-3 py-2 text-sm font-semibold text-kobipo-navy hover:bg-kobipo-pale dark:text-foreground dark:hover:bg-muted"
            >
              Fişlere git
            </CompanyLink>
          </div>
        </Kart>
      )}

      {veri && !bos && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">Bilanço · {gunMetni(bit)}</h2>
            <div className="grid gap-4">
              <BilancoTarafi baslik="Aktif" bolumler={b!.aktif} toplam={b!.aktifToplam} />
              <BilancoTarafi baslik="Pasif" bolumler={b!.pasif} toplam={b!.pasifToplam} />
            </div>
            {b!.yenidenSiniflanan.length > 0 && (
              <p className="text-xs text-kobipo-gray">
                Ters bakiyeli {b!.yenidenSiniflanan.length} cari/personel alt hesabı avans ya da alacak olarak yeniden sınıflandı (340 / 159 /
                135).
              </p>
            )}
          </Kart>
          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">
              Gelir Tablosu · {gunMetni(bas)} – {gunMetni(bit)}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {veri.gelirTablosu.kalemler.map((k, i) => (
                  <GelirSatiri key={i} k={k} />
                ))}
              </tbody>
            </table>
          </Kart>
        </div>
      )}
    </div>
  )
}

function BilancoTarafi({ baslik, bolumler, toplam }: { baslik: string; bolumler: TabloBolumu[]; toplam: number }) {
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-kobipo-border text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
            <th className="py-1.5">{baslik}</th>
            <th className="py-1.5 text-right">₺</th>
          </tr>
        </thead>
        <tbody>
          {bolumler.map((bol) => (
            <BolumSatirlari key={bol.kod} bol={bol} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-kobipo-border font-bold text-kobipo-navy dark:text-foreground">
            <td className="py-2">{baslik} toplamı</td>
            <td className="py-2 text-right tabular-nums">{isaretli(toplam)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function BolumSatirlari({ bol }: { bol: TabloBolumu }) {
  if (bol.gruplar.length === 0) return null
  return (
    <>
      <tr className="bg-kobipo-offwhite font-semibold text-kobipo-navy dark:bg-muted/40 dark:text-foreground">
        <td className="px-1 py-1.5">
          {bol.kod}. {bol.ad}
        </td>
        <td className="px-1 py-1.5 text-right tabular-nums">{isaretli(bol.tutar)}</td>
      </tr>
      {bol.gruplar.map((g) => (
        <GrupSatirlari key={g.kod} g={g} />
      ))}
    </>
  )
}

function GrupSatirlari({ g }: { g: TabloBolumu["gruplar"][number] }) {
  return (
    <>
      <tr className="text-kobipo-navy dark:text-foreground">
        <td className="py-1 pl-3 font-medium">{g.ad}</td>
        <td className="py-1 text-right font-medium tabular-nums">{isaretli(g.tutar)}</td>
      </tr>
      {g.satirlar.map((s) => (
        <tr key={s.kod + s.ad} className="text-kobipo-gray">
          <td className="py-0.5 pl-7">
            {s.kod !== "—" && <span className="font-mono text-xs">{s.kod} </span>}
            {s.ad}
          </td>
          <td className="py-0.5 text-right tabular-nums">{isaretli(s.tutar)}</td>
        </tr>
      ))}
    </>
  )
}

function GelirSatiri({ k }: { k: GelirTablosuKalemi }) {
  return (
    <>
      <tr
        className={cn(
          "border-t border-kobipo-border/60",
          k.ara ? "bg-kobipo-offwhite font-bold text-kobipo-navy dark:bg-muted/40 dark:text-foreground" : "text-kobipo-navy dark:text-foreground",
        )}
      >
        <td className="px-1 py-1.5">
          {k.kod && <span className="mr-1.5 text-kobipo-gray">{k.kod}.</span>}
          {k.ad}
        </td>
        <td className="px-1 py-1.5 text-right tabular-nums">{isaretli(k.tutar)}</td>
      </tr>
      {k.satirlar?.map((s) => (
        <tr key={s.kod} className="text-kobipo-gray">
          <td className="py-0.5 pl-7">
            <span className="font-mono text-xs">{s.kod}</span> {s.ad}
          </td>
          <td className="py-0.5 text-right tabular-nums">{isaretli(s.tutar)}</td>
        </tr>
      ))}
    </>
  )
}
