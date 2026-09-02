"use client"

/**
 * Fiş Tarama — fotoğraftan alış fişi.
 *
 * Akış: fotoğraf → model okur → her fiş için ONAY KARTI (düzenlenebilir) →
 * kullanıcı onaylayınca alış fişi kesilir. Kartın kendisi ve kayıt mantığı
 * `fis-onay-karti.tsx` içinde; burası kareyi taşıyan kabuk.
 *
 * ÖLÇÜM PANELİ (model seçici, token, $ maliyet, ham JSON) artık varsayılan
 * olarak GİZLİ: model seçmek kullanıcının işi değil ve dolar maliyeti onun
 * ekranında işi olmayan bir sayı. `NEXT_PUBLIC_FIS_TARAMA_DEBUG=1` ile açılır —
 * yeni model denerken ölçüm hâlâ buradan yapılabilsin diye silinmedi.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { ReadOnlyBanner, WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import type { Fis } from "@/lib/fis-ocr/schema"
import type { Denetim } from "@/lib/fis-ocr/validate"
import { FisOnayKarti } from "@/components/alis/fis-onay-karti"

const AYIKLAMA = process.env.NEXT_PUBLIC_FIS_TARAMA_DEBUG === "1"

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
  // Tarama kimliği: aynı fotoğraf yeniden okutulunca onay kartları SIFIRDAN
  // kurulmalı. Key vermezsek React eski kartın düzenlenmiş state'ini yeni
  // çıkarımın üstünde tutar ve kullanıcı iki fişin karışımını kaydeder.
  const [taramaId, setTaramaId] = useState(0)
  const girdiRef = useRef<HTMLInputElement>(null)

  // Seçili firma değişince eldeki çıkarım BAŞKA firmanın ekranında kalmasın:
  // kaydet düğmesi yeni firmanın companyId'siyle çalışırdı ve fiş yanlış
  // firmaya yazılırdı.
  useEffect(() => {
    setFisler(null)
    setOlcum(null)
    setHata(null)
  }, [selectedCompanyId])

  const dosyaSec = useCallback(
    (f: File | null) => {
      if (f && !canWrite) return refuse()
      setDosya(f)
      setFisler(null)
      setOlcum(null)
      setHata(null)
      setOnizleme((eski) => {
        if (eski) URL.revokeObjectURL(eski)
        return f ? URL.createObjectURL(f) : null
      })
    },
    [canWrite, refuse]
  )

  const tara = useCallback(async () => {
    if (!dosya) return
    setYukleniyor(true)
    setHata(null)
    setFisler(null)
    setOlcum(null)
    try {
      const fd = new FormData()
      fd.append("file", dosya)
      if (AYIKLAMA) fd.append("model", model)
      if (selectedCompanyId) fd.append("companyId", selectedCompanyId)
      const r = await fetch("/api/alis/fis-tarama", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || "Fiş taranamadı")
      setFisler(j.fisler)
      setOlcum(j.olcum)
      setTaramaId((n) => n + 1)
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
        <h1 className="text-2xl font-bold">Fiş Tarama</h1>
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
          Fiş fotoğrafını okutup <strong>alış fişi</strong> olarak kaydeder. Her fiş
          kaydedilmeden önce ekranda düzeltilebilir; kayıt yalnız siz onaylayınca oluşur.
        </p>
      </div>

      <ReadOnlyBanner />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---------------------------------------------------------- sol: girdi */}
        <Card className="self-start">
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

            {AYIKLAMA && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Model (yalnız ayıklama modunda)
                </label>
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
            )}

            <WriteAction>
              <Button onClick={tara} disabled={!dosya || yukleniyor} className="w-full">
                {yukleniyor ? "Okunuyor…" : "Tara"}
              </Button>
            </WriteAction>

            <p className="text-xs text-muted-foreground">
              Fotoğraf <strong>saklanmaz</strong>: okuma bittiğinde silinir, yalnız
              çıkardığı bilgi ekranda kalır. Kaydetmeden önce rakamları fişle
              karşılaştırın.
            </p>

            {hata && (
              <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
                {hata}
              </p>
            )}
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- sağ: sonuç */}
        <div className="space-y-4">
          {AYIKLAMA && olcum && <OlcumKarti olcum={olcum} fisAdedi={fisler?.length ?? 0} />}

          {selectedCompanyId &&
            fisler?.map((f, i) => (
              <FisOnayKarti
                key={`${taramaId}-${i}`}
                sonuc={f}
                sira={i + 1}
                companyId={selectedCompanyId}
              />
            ))}

          {fisler && fisler.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Görselde fiş bulunamadı.
              </CardContent>
            </Card>
          )}

          {AYIKLAMA && fisler && (
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
                Bir fotoğraf seçip <strong>Tara</strong>ya basın. Okunan her fiş burada
                düzenlenebilir bir kart olarak açılır; onayladığınız kart alış fişine
                dönüşür.
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
    ["1000 fiş", olcum.fisBasinaUsd != null ? "$" + (olcum.fisBasinaUsd * 1000).toFixed(2) : "—"],
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
