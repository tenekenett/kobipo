"use client"

/**
 * Fiş Tarama — TEST ekranı.
 *
 * Amaç kayıt üretmek değil ÖLÇMEK: aynı fotoğrafı farklı modellerle okutup
 * doğruluğu, gecikmeyi ve gerçek maliyeti yan yana görmek. Bu yüzden ekran
 * modelin çıktısını "sonuç" gibi değil, yanında denetimleriyle birlikte gösterir.
 *
 * Kayda geçirme (fiş/fatura oluşturma) BİLEREK YOK — o adım kullanıcı onay akışı
 * tasarlandıktan sonra gelecek.
 */

import { useCallback, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  ReadOnlyBanner,
  WriteAction,
  useWriteGuard,
} from "@/components/dashboard/write-guard"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import type { Fis } from "@/lib/fis-ocr/schema"
import type { Denetim } from "@/lib/fis-ocr/validate"

type FisSonucu = { fis: Fis; denetimler: Denetim[]; insanaSorulmali: boolean }

type Olcum = {
  model: string
  saglayici: string
  sureMs: number
  kullanim: {
    girdiToken: number
    ciktiToken: number
    dusunmeToken: number
    maliyetUsd: number | null
  }
  gorsel: { genislik: number; yukseklik: number; boyutKb: number }
  fisBasinaUsd: number | null
}

const para = (n: number | null | undefined, basamak = 5) =>
  n == null ? "—" : "$" + n.toFixed(basamak)

const tl = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

export function FisTaramaScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  // Her tarama PARA HARCIYOR — salt-okunur üyelik hesabın faturasını kabartamamalı.
  // Yazma yolu iki tane: düğme (WriteAction ile gizlenir) ve fotoğrafı sürükleyip
  // bırakmak; ikincisini düğme gizlemek durduramaz, o yüzden burada süzülüyor.
  const { canWrite, refuse } = useWriteGuard()
  const [dosya, setDosya] = useState<File | null>(null)
  const [onizleme, setOnizleme] = useState<string | null>(null)
  const [model, setModel] = useState(DENENEBILIR_MODELLER[0].id)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [fisler, setFisler] = useState<FisSonucu[] | null>(null)
  const [olcum, setOlcum] = useState<Olcum | null>(null)
  const [hamGoster, setHamGoster] = useState(false)
  const girdiRef = useRef<HTMLInputElement>(null)

  const dosyaSec = useCallback((f: File | null) => {
    if (f && !canWrite) return refuse()
    setDosya(f)
    setFisler(null)
    setOlcum(null)
    setHata(null)
    setOnizleme((eski) => {
      if (eski) URL.revokeObjectURL(eski)
      return f ? URL.createObjectURL(f) : null
    })
  }, [canWrite, refuse])

  const tara = useCallback(async () => {
    if (!dosya) return
    setYukleniyor(true)
    setHata(null)
    setFisler(null)
    setOlcum(null)
    try {
      const fd = new FormData()
      fd.append("file", dosya)
      fd.append("model", model)
      if (selectedCompanyId) fd.append("companyId", selectedCompanyId)
      const r = await fetch("/api/alis/fis-tarama", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || "Fiş taranamadı")
      setFisler(j.fisler)
      setOlcum(j.olcum)
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setYukleniyor(false)
    }
  }, [dosya, model, selectedCompanyId])

  // Menüde gizli olsa da adres çubuğuna elle yazılabiliyor. Uç zaten 403 döner;
  // burada NEDEN kapalı olduğunu söylemek boş bir yükleyici bırakmaktan iyi.
  if (selectedCompany && selectedCompany.isFisTaramaEnabled !== true) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Fiş Tarama</h1>
        </div>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Fiş tarama şu anda sınırlı sayıda firmayla yürütülen bir denemededir ve bu
            firma için açık değil.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Fiş Tarama</h1>
        <p className="text-sm text-muted-foreground">
          Fiş fotoğrafını yapay zekâya okutur. <strong>Test ekranı</strong> — hiçbir kayıt
          oluşturmaz, yalnız çıkarımı, denetimleri ve gerçek maliyeti gösterir.
        </p>
      </div>

      <ReadOnlyBanner />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---------------------------------------------------------- sol: girdi */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fotoğraf</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={girdiRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => dosyaSec(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => girdiRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                dosyaSec(e.dataTransfer.files?.[0] ?? null)
              }}
              className="flex h-56 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-kobipo-border bg-kobipo-offwhite text-sm text-muted-foreground transition hover:border-kobipo-blue"
            >
              {onizleme ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={onizleme} alt="Seçilen fiş" className="h-full w-full object-contain" />
              ) : (
                <span className="px-4 text-center">
                  Fotoğrafı sürükleyin veya seçmek için tıklayın
                  <br />
                  <span className="text-xs">Birden fazla fişi tek karede çekebilirsiniz</span>
                </span>
              )}
            </button>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm"
              >
                {DENENEBILIR_MODELLER.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.etiket}
                  </option>
                ))}
              </select>
            </div>

            <WriteAction>
              <Button onClick={tara} disabled={!dosya || yukleniyor} className="w-full">
                {yukleniyor ? "Okunuyor…" : "Tara"}
              </Button>
            </WriteAction>

            {hata && (
              <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
                {hata}
              </p>
            )}
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- sağ: sonuç */}
        <div className="space-y-4">
          {olcum && <OlcumKarti olcum={olcum} fisAdedi={fisler?.length ?? 0} />}

          {fisler?.map((f, i) => <FisKarti key={i} sonuc={f} sira={i + 1} />)}

          {fisler && fisler.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Görselde fiş bulunamadı.
              </CardContent>
            </Card>
          )}

          {fisler && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Ham çıktı</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setHamGoster((v) => !v)}>
                  {hamGoster ? "Gizle" : "Göster"}
                </Button>
              </CardHeader>
              {hamGoster && (
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md bg-kobipo-offwhite p-3 text-xs">
                    {JSON.stringify(fisler.map((f) => f.fis), null, 2)}
                  </pre>
                </CardContent>
              )}
            </Card>
          )}

          {!fisler && !yukleniyor && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Bir fotoğraf seçip <strong>Tara</strong>ya basın. Sonuçlar, harcanan token ve
                gerçek maliyet burada listelenir.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function OlcumKarti({ olcum, fisAdedi }: { olcum: Olcum; fisAdedi: number }) {
  const k = olcum.kullanim
  const satirlar: Array<[string, string]> = [
    ["Model", olcum.model],
    ["Sağlayıcı", olcum.saglayici],
    ["Süre", (olcum.sureMs / 1000).toFixed(1) + " sn"],
    ["Görsel", `${olcum.gorsel.genislik}×${olcum.gorsel.yukseklik} · ${olcum.gorsel.boyutKb} KB`],
    ["Girdi token", k.girdiToken.toLocaleString("tr-TR")],
    [
      "Çıktı token",
      k.dusunmeToken
        ? `${k.ciktiToken.toLocaleString("tr-TR")} (${k.dusunmeToken.toLocaleString("tr-TR")} düşünme)`
        : k.ciktiToken.toLocaleString("tr-TR"),
    ],
    ["Kare maliyeti", para(k.maliyetUsd)],
    ["Fiş başına", para(olcum.fisBasinaUsd)],
    [
      "1000 fiş",
      olcum.fisBasinaUsd != null ? "$" + (olcum.fisBasinaUsd * 1000).toFixed(2) : "—",
    ],
    ["Bulunan fiş", String(fisAdedi)],
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ölçüm</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {satirlar.map(([etiket, deger]) => (
            <div key={etiket}>
              <dt className="text-xs text-muted-foreground">{etiket}</dt>
              <dd className="font-medium tabular-nums break-words">{deger}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function DenetimRozeti({ d }: { d: Denetim }) {
  const stil =
    d.durum === "gecti"
      ? "bg-kobipo-green-light text-kobipo-green-dark"
      : d.durum === "patladi"
        ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        : "bg-kobipo-offwhite text-kobipo-gray"
  const isaret = d.durum === "gecti" ? "✓" : d.durum === "patladi" ? "✗" : "—"
  return (
    <span
      title={d.aciklama}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stil}`}
    >
      {isaret} {d.etiket}
    </span>
  )
}

function FisKarti({ sonuc, sira }: { sonuc: FisSonucu; sira: number }) {
  const { fis, denetimler } = sonuc
  const g = fis.guven
  const enDusukGuven = g ? Math.min(g.satici, g.tarih, g.toplam, g.kalemler) : null
  return (
    <Card className={sonuc.insanaSorulmali ? "border-amber-400" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {sira}. {fis.saticiUnvan || "Satıcı okunamadı"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {fis.vknTckn || "VKN yok"} · {fis.tarih || "tarih yok"}
            {fis.fisNo ? ` · Fiş ${fis.fisNo}` : ""}
            {enDusukGuven != null ? ` · güven ${enDusukGuven.toFixed(2)}` : ""}
          </p>
        </div>
        {sonuc.insanaSorulmali && (
          <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            Kontrol gerek
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {denetimler.map((d) => (
            <DenetimRozeti key={d.anahtar} d={d} />
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Kalem</th>
                <th className="py-1 px-2 text-right font-medium">Miktar</th>
                <th className="py-1 px-2 text-right font-medium">Birim</th>
                <th className="py-1 px-2 text-right font-medium">KDV</th>
                <th className="py-1 pl-2 text-right font-medium">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {fis.kalemler.map((k, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2">{k.ad}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{k.miktar ?? "—"}</td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {k.birimFiyat != null ? tl(k.birimFiyat) : "—"}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {k.kdvOrani != null ? `%${k.kdvOrani}` : "—"}
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums">{tl(k.tutar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Ara toplam <span className="font-medium text-foreground">{tl(fis.araToplam)}</span>
          </span>
          <span className="text-muted-foreground">
            KDV <span className="font-medium text-foreground">{tl(fis.kdvToplam)}</span>
          </span>
          <span className="text-muted-foreground">
            Genel toplam{" "}
            <span className="text-base font-bold text-foreground">{tl(fis.genelToplam)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
