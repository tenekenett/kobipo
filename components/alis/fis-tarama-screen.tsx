"use client"

/**
 * Belge Tarama — fotoğraf / PDF / UBL XML'den kayıt. (URL /alis/fis-tarama KALIR;
 * bu dosya fiş taramanın tek türlü ilk hâlinden büyüdü — plan §3.9.)
 *
 * Akış: dosyalar → her biri ayrı istekle boru hattından geçer (sınıf + türe özel
 * çıkarım + denetim) → her belge için ONAY KARTI → kullanıcı onaylayınca kayıt
 * türün kendi ucuna gider. Kartlar `belge/` altında; fiş kartı dokunulmadan kaldı.
 *
 * GELEN KUTUSU: okunan her dosya document_scans satırıdır; onaylanmadan kapatılan
 * ekran belgeyi kaybetmez, kutudan geri açılır. Dosya SAKLANMAZ (karar B): yeniden
 * okuma (yanlış tür) yalnız aynı oturumda, dosya hâlâ bellekteyken yapılabilir.
 *
 * ÖLÇÜM PANELİ (model seçici, $ maliyet) varsayılan olarak GİZLİ;
 * NEXT_PUBLIC_FIS_TARAMA_DEBUG=1 ile açılır.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { ReadOnlyBanner, WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import type { TaramaSatiri } from "@/lib/belge-ocr/kayit"
import type { BelgeTuru } from "@/lib/belge-ocr/turler"
import { BelgeKartlari } from "@/components/alis/belge/belge-kartlari"
import { GelenKutusu } from "@/components/alis/belge/gelen-kutusu"
import { KAYDEDILDI_OLAYI } from "@/components/alis/belge/kabuk"
import { FileText, Loader2, Trash2 } from "lucide-react"

const AYIKLAMA = process.env.NEXT_PUBLIC_FIS_TARAMA_DEBUG === "1"
const KABUL = "image/*,application/pdf,text/xml,application/xml,.xml,.pdf"

type Kuyruk = {
  key: string
  dosya: File
  durum: "bekliyor" | "okunuyor" | "okundu" | "hata" | "mukerrer"
  mesaj?: string
  scanId?: string
  /** Aynı dosya daha önce okunmuş: mevcut satır */
  onceki?: { id: string; status: string }
}

export function BelgeTaramaScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  // Her tarama PARA HARCIYOR — salt-okunur üyelik hesabın faturasını kabartamamalı.
  // Düğme WriteAction ile gizlenir; sürükle-bırak yolu burada süzülür.
  const { canWrite, refuse } = useWriteGuard()
  const [kuyruk, setKuyruk] = useState<Kuyruk[]>([])
  const [model, setModel] = useState(DENENEBILIR_MODELLER[0].id)
  const [calisiyor, setCalisiyor] = useState(false)
  const [satirlar, setSatirlar] = useState<Map<string, TaramaSatiri>>(new Map())
  const [seciliId, setSeciliId] = useState<string | null>(null)
  const [seciliYukleniyor, setSeciliYukleniyor] = useState(false)
  const [kutuAnahtari, setKutuAnahtari] = useState(0)
  const [saglik, setSaglik] = useState<{ durum: "calisiyor" | "ok" | "hata"; metin: string } | null>(null)
  const girdiRef = useRef<HTMLInputElement>(null)

  // Firma değişince eldeki çıkarım BAŞKA firmanın ekranında kalmasın.
  useEffect(() => {
    setKuyruk([])
    setSatirlar(new Map())
    setSeciliId(null)
  }, [selectedCompanyId])

  // Kart bir kayıt yazınca gelen kutusu tazelenir ve satırın durumu/izleri
  // yerelde güncellenir (kutuda "Onay bekliyor" yalan söylemesin).
  useEffect(() => {
    const dinle = (e: Event) => {
      const d = (e as CustomEvent).detail as { scanId: string; status: string | null; targets: unknown } | undefined
      if (!d) return
      setKutuAnahtari((n) => n + 1)
      setSatirlar((m) => {
        const eski = m.get(d.scanId)
        if (!eski) return m
        return new Map(m).set(d.scanId, { ...eski, status: (d.status as TaramaSatiri["status"]) ?? eski.status, targets: (d.targets as TaramaSatiri["targets"]) ?? eski.targets })
      })
    }
    window.addEventListener(KAYDEDILDI_OLAYI, dinle)
    return () => window.removeEventListener(KAYDEDILDI_OLAYI, dinle)
  }, [])

  const dosyaEkle = useCallback(
    (liste: FileList | File[] | null) => {
      if (!liste || liste.length === 0) return
      if (!canWrite) return refuse()
      const yeni = Array.from(liste).map((f) => ({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, dosya: f, durum: "bekliyor" as const }))
      setKuyruk((k) => [...k, ...yeni])
    },
    [canWrite, refuse]
  )

  const dosyaGonder = useCallback(
    async (k: Kuyruk, secenek: { force?: boolean; tur?: BelgeTuru } = {}): Promise<Kuyruk> => {
      const fd = new FormData()
      fd.append("file", k.dosya)
      if (selectedCompanyId) fd.append("companyId", selectedCompanyId)
      if (AYIKLAMA) fd.append("model", model)
      if (secenek.force) fd.append("force", "1")
      if (secenek.tur) fd.append("tur", secenek.tur)
      const r = await fetch("/api/alis/belge-tarama", { method: "POST", body: fd })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j?.code === "DUPLICATE_FILE") {
        return { ...k, durum: "mukerrer", mesaj: j.error, onceki: j.onceki }
      }
      if (!r.ok) return { ...k, durum: "hata", mesaj: j?.error || "Belge okunamadı", scanId: j?.scanId }
      const satir = j as TaramaSatiri
      setSatirlar((m) => new Map(m).set(satir.id, satir))
      setSeciliId(satir.id)
      setKutuAnahtari((n) => n + 1)
      return { ...k, durum: "okundu", scanId: satir.id }
    },
    [selectedCompanyId, model]
  )

  // Kuyruk SIRA SIRA gider: tek istek = tek dosya (plan §3.4). Paralel göndermek
  // 60 sn'lik uç sınırını değil, aynı anda N model çağrısını doğururdu.
  const tara = useCallback(async () => {
    setCalisiyor(true)
    try {
      for (const k of kuyruk) {
        if (k.durum !== "bekliyor") continue
        setKuyruk((q) => q.map((x) => (x.key === k.key ? { ...x, durum: "okunuyor" } : x)))
        const sonuc = await dosyaGonder(k)
        setKuyruk((q) => q.map((x) => (x.key === k.key ? sonuc : x)))
      }
    } finally {
      setCalisiyor(false)
    }
  }, [kuyruk, dosyaGonder])

  const yineDeOku = useCallback(
    async (k: Kuyruk) => {
      setKuyruk((q) => q.map((x) => (x.key === k.key ? { ...x, durum: "okunuyor" } : x)))
      const sonuc = await dosyaGonder(k, { force: true })
      setKuyruk((q) => q.map((x) => (x.key === k.key ? sonuc : x)))
    },
    [dosyaGonder]
  )

  const yenidenOku = useCallback(
    async (scanId: string, tur: BelgeTuru) => {
      const k = kuyruk.find((x) => x.scanId === scanId)
      if (!k) return
      setKuyruk((q) => q.map((x) => (x.key === k.key ? { ...x, durum: "okunuyor" } : x)))
      const sonuc = await dosyaGonder(k, { force: true, tur })
      setKuyruk((q) => q.map((x) => (x.key === k.key ? sonuc : x)))
    },
    [kuyruk, dosyaGonder]
  )

  // PDF katmanının bu ortamda çalışıp çalışmadığını ölçer (model çağrısı yok,
  // para harcamaz): metin katmanı, gömülü/vektör karekod, ek, raster. Yerelde
  // geçen şey Vercel'de geçmeyebilir; sonuç olduğu gibi yazılır.
  const sistemKontrolu = useCallback(async () => {
    if (!selectedCompanyId) return
    setSaglik({ durum: "calisiyor", metin: "Ölçülüyor…" })
    try {
      const r = await fetch(`/api/alis/belge-tarama/saglik?companyId=${encodeURIComponent(selectedCompanyId)}`)
      const j = await r.json().catch(() => ({}))
      const adim = (ad: string, ok: boolean | undefined) => `${ad} ${ok ? "✓" : "✗"}`
      const metin = j?.error
        ? String(j.error)
        : [
            adim("metin katmanı", j.metinKatmani?.var),
            adim("gömülü karekod", j.gomuluKarekod?.cozuldu),
            adim("vektör karekod (raster)", j.vektorKarekod?.cozuldu),
            adim("XML eki", j.ek?.ubl === 1),
            adim("sayfa raster", j.raster?.ok),
            `${j.platform ?? "?"}${j.vercel ? " · Vercel" : " · yerel"} · ${j.toplamMs ?? "?"} ms`,
            j.raster?.sebep ? `— ${j.raster.sebep}` : "",
            j.hata ? `— ${j.hata}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
      setSaglik({ durum: r.ok && j.ok ? "ok" : "hata", metin })
    } catch (e: any) {
      setSaglik({ durum: "hata", metin: e?.message || "Ölçüm yapılamadı" })
    }
  }, [selectedCompanyId])

  const satirAc = useCallback(
    async (id: string) => {
      setSeciliId(id)
      if (satirlar.has(id)) return
      setSeciliYukleniyor(true)
      try {
        const r = await fetch(`/api/alis/belge-tarama/${id}`)
        const j = await r.json().catch(() => ({}))
        if (r.ok) setSatirlar((m) => new Map(m).set(id, j as TaramaSatiri))
      } finally {
        setSeciliYukleniyor(false)
      }
    },
    [satirlar]
  )

  if (selectedCompany && selectedCompany.isFisTaramaEnabled !== true) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Belge Tarama</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Belge tarama şu anda sınırlı sayıda firmayla yürütülen bir denemededir ve bu firma için açık değil.
          </CardContent>
        </Card>
      </div>
    )
  }

  const secili = seciliId ? satirlar.get(seciliId) ?? null : null
  const seciliDosya = seciliId ? kuyruk.find((k) => k.scanId === seciliId)?.dosya ?? null : null
  const bekleyen = kuyruk.filter((k) => k.durum === "bekliyor").length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Belge Tarama</h1>
        <p className="text-sm text-muted-foreground">
          Fiş, fatura, irsaliye, dekont, çek ve senedi fotoğraf, PDF ya da UBL XML olarak okutup kayda çevirir. Belgenin ne olduğunu sistem bulur; her kayıt siz onaylayınca oluşur.
        </p>
      </div>

      <ReadOnlyBanner />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Belgeler</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input ref={girdiRef} type="file" accept={KABUL} multiple className="hidden" onChange={(e) => { dosyaEkle(e.target.files); e.target.value = "" }} />
              <button
                type="button"
                onClick={() => girdiRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  dosyaEkle(e.dataTransfer.files)
                }}
                className="flex h-32 w-full items-center justify-center rounded-lg border-2 border-dashed border-kobipo-border bg-kobipo-offwhite px-4 text-center text-sm text-muted-foreground transition hover:border-kobipo-blue"
              >
                <span>
                  Dosyaları sürükleyin veya seçmek için tıklayın
                  <br />
                  <span className="text-xs">Fotoğraf, PDF (en çok 10 sayfa), UBL XML · birden çok dosya</span>
                </span>
              </button>

              {kuyruk.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {kuyruk.map((k) => (
                    <li key={k.key} className="flex items-center gap-2 rounded-md border border-kobipo-border px-2 py-1">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => k.scanId && satirAc(k.scanId)} title={k.dosya.name}>
                        {k.dosya.name}
                      </button>
                      {k.durum === "okunuyor" && <Loader2 className="h-3.5 w-3.5 animate-spin text-kobipo-blue" />}
                      {k.durum === "okundu" && <span className="font-semibold text-kobipo-green-dark">okundu</span>}
                      {k.durum === "hata" && <span className="truncate text-red-700" title={k.mesaj}>{k.mesaj}</span>}
                      {k.durum === "mukerrer" && (
                        <span className="flex items-center gap-1 text-amber-800">
                          daha önce okunmuş
                          {k.onceki && <button type="button" className="underline" onClick={() => satirAc(k.onceki!.id)}>aç</button>}
                          <button type="button" className="underline" onClick={() => yineDeOku(k)}>yine de oku</button>
                        </span>
                      )}
                      {k.durum === "bekliyor" && (
                        <button type="button" title="Kuyruktan çıkar" onClick={() => setKuyruk((q) => q.filter((x) => x.key !== k.key))} className="text-muted-foreground hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {AYIKLAMA && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Model (yalnız ayıklama modunda)</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
                    {DENENEBILIR_MODELLER.map((m) => (
                      <option key={m.id} value={m.id}>{m.etiket}</option>
                    ))}
                  </select>
                </div>
              )}

              <WriteAction>
                <Button onClick={tara} disabled={bekleyen === 0 || calisiyor} className="w-full">
                  {calisiyor ? "Okunuyor…" : bekleyen > 1 ? `${bekleyen} dosyayı oku` : "Oku"}
                </Button>
              </WriteAction>

              <p className="text-xs text-muted-foreground">
                Dosyalar <strong>saklanmaz</strong>: okuma bittiğinde silinir, yalnız çıkarılan bilgi gelen kutusunda kalır. Kaydetmeden önce rakamları belgeyle karşılaştırın.
              </p>

              <div className="space-y-1 border-t pt-2">
                <Button variant="ghost" size="sm" onClick={sistemKontrolu} disabled={saglik?.durum === "calisiyor"} className="h-7 px-2 text-xs">
                  Sistem kontrolü (PDF katmanı, model çağrısı yok)
                </Button>
                {saglik && (
                  <p className={`text-[11px] ${saglik.durum === "ok" ? "text-kobipo-green-dark" : saglik.durum === "hata" ? "text-red-700" : "text-muted-foreground"}`}>{saglik.metin}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedCompanyId && <GelenKutusu companyId={selectedCompanyId} seciliId={seciliId} onSec={satirAc} yenilemeAnahtari={kutuAnahtari} />}
        </div>

        <div className="space-y-4">
          {AYIKLAMA && secili?.extraction && (
            <Card>
              <CardContent className="grid grid-cols-2 gap-2 p-4 text-xs sm:grid-cols-4">
                <div><span className="text-muted-foreground">Yol</span><br />{secili.extraction.yol}</div>
                <div><span className="text-muted-foreground">Model</span><br />{secili.model} · {secili.extraction.saglayici}</div>
                <div><span className="text-muted-foreground">Süre</span><br />{secili.durationMs != null ? (secili.durationMs / 1000).toFixed(1) + " sn" : "—"}</div>
                <div><span className="text-muted-foreground">Maliyet</span><br />{secili.costUsd != null ? "$" + secili.costUsd.toFixed(5) : "—"} · {secili.pageCount} sayfa</div>
                {secili.extraction.karekodNotu && <div className="col-span-2 text-amber-800 sm:col-span-4">{secili.extraction.karekodNotu}</div>}
              </CardContent>
            </Card>
          )}

          {seciliYukleniyor && (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Yükleniyor…</CardContent></Card>
          )}

          {secili && selectedCompanyId && secili.status !== "FAILED" && (
            <BelgeKartlari key={secili.id + "-" + secili.updatedAt} satir={secili} companyId={selectedCompanyId} dosya={seciliDosya} onYenidenOku={seciliDosya ? (tur) => yenidenOku(secili.id, tur) : undefined} />
          )}
          {secili && secili.status === "FAILED" && (
            <Card className="border-red-300"><CardContent className="p-6 text-sm text-red-700">{secili.error || "Okuma başarısız."}</CardContent></Card>
          )}

          {!secili && !seciliYukleniyor && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Dosya seçip <strong>Oku</strong>ya basın. Okunan her belge burada düzenlenebilir bir kart olarak açılır; onayladığınız kart faturaya, irsaliyeye, ödemeye ya da çek/senet kaydına dönüşür. Daha önce okunanlar gelen kutusunda.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
