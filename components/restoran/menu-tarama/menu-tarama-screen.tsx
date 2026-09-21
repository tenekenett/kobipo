"use client"

/**
 * Menü Tarama — kafenin basılı menüsü (fotoğraf / PDF) → satışa hazır ürün.
 * Plan: docs/menu-tarama/PLAN.md.
 *
 * Akış: dosyalar (aynı menünün sayfaları) → TEK oturum, dosya başına ayrı istek
 * (sessionId ilk yanıttan gelir) → fark listesi (oturum kartı) → satır satır
 * kayıt. Okunmuş ama onaylanmamış oturum gelen kutusunda kalır.
 *
 * Reçete bu ekranın işi DEĞİL; kart reçetesizliği söyler ve menü ekranına yollar.
 * Dosya SAKLANMAZ. ÖLÇÜM PANELİ (model seçici) NEXT_PUBLIC_FIS_TARAMA_DEBUG=1 ile.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { ReadOnlyBanner, WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import { KDV_ORANLARI, VARSAYILAN_KDV } from "@/lib/menu-ocr/fiyat"
import { MenuGelenKutusu } from "./gelen-kutusu"
import { OturumKarti } from "./oturum-karti"
import { FileText, Loader2, Trash2 } from "lucide-react"

const AYIKLAMA = process.env.NEXT_PUBLIC_FIS_TARAMA_DEBUG === "1"
const KABUL = "image/*,application/pdf,.pdf"
const MAX_DOSYA = 10

type Kuyruk = {
  key: string
  dosya: File
  durum: "bekliyor" | "okunuyor" | "okundu" | "hata" | "mukerrer"
  mesaj?: string
  kalem?: number
  onceki?: { sessionId: string | null }
}

export function MenuTaramaScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  // Her okuma PARA HARCIYOR — salt-okunur üyelik hesabın faturasını kabartamamalı.
  const { canWrite, refuse } = useWriteGuard()
  const [kuyruk, setKuyruk] = useState<Kuyruk[]>([])
  const [model, setModel] = useState(DENENEBILIR_MODELLER[0].id)
  const [kdv, setKdv] = useState<number>(VARSAYILAN_KDV)
  const [tamami, setTamami] = useState(false)
  const [calisiyor, setCalisiyor] = useState(false)
  const [seciliOturum, setSeciliOturum] = useState<string | null>(null)
  // Bu yükleme kuyruğunun KENDİ oturumu. `seciliOturum`dan ayrı tutulur: kutudan
  // eski bir menü açılmışken "yine de oku" denirse dosya o eski oturuma değil,
  // kuyruğun oturumuna gider (Chrome turunda yakalandı). Kuyruk temizlenince sıfırlanır.
  const [kuyrukOturumu, setKuyrukOturumu] = useState<string | null>(null)
  const [kutuAnahtari, setKutuAnahtari] = useState(0)
  const girdiRef = useRef<HTMLInputElement>(null)

  // Firma değişince eldeki oturum BAŞKA firmanın ekranında kalmasın.
  useEffect(() => {
    setKuyruk([])
    setKuyrukOturumu(null)
    setSeciliOturum(null)
  }, [selectedCompanyId])

  const dosyaEkle = useCallback(
    (liste: FileList | File[] | null) => {
      if (!liste || liste.length === 0) return
      if (!canWrite) return refuse()
      const yeni = Array.from(liste).map((f) => ({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, dosya: f, durum: "bekliyor" as const }))
      setKuyruk((k) => [...k, ...yeni].slice(0, MAX_DOSYA))
    },
    [canWrite, refuse]
  )

  const dosyaGonder = useCallback(
    async (k: Kuyruk, sessionId: string | null, secenek: { force?: boolean } = {}): Promise<{ satir: Kuyruk; sessionId: string | null }> => {
      const fd = new FormData()
      fd.append("file", k.dosya)
      if (selectedCompanyId) fd.append("companyId", selectedCompanyId)
      if (sessionId) fd.append("sessionId", sessionId)
      fd.append("kdv", String(kdv))
      fd.append("tamami", tamami ? "1" : "0")
      if (AYIKLAMA) fd.append("model", model)
      if (secenek.force) fd.append("force", "1")
      const r = await fetch("/api/restoran/menu-tarama", { method: "POST", body: fd })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j?.code === "DUPLICATE_FILE") {
        return { satir: { ...k, durum: "mukerrer", mesaj: j.error, onceki: { sessionId: j.onceki?.sessionId ?? null } }, sessionId }
      }
      if (!r.ok) return { satir: { ...k, durum: "hata", mesaj: j?.error || "Menü okunamadı" }, sessionId: j?.sessionId ?? sessionId }
      setKutuAnahtari((n) => n + 1)
      return { satir: { ...k, durum: "okundu", kalem: j.kalem }, sessionId: j.sessionId ?? sessionId }
    },
    [selectedCompanyId, kdv, tamami, model]
  )

  // Kuyruk SIRA SIRA gider: tek istek = tek dosya; hepsi kuyruğun oturumuna yazılır.
  const oku = useCallback(async () => {
    setCalisiyor(true)
    let sessionId = kuyrukOturumu
    try {
      for (const k of kuyruk) {
        if (k.durum !== "bekliyor") continue
        setKuyruk((q) => q.map((x) => (x.key === k.key ? { ...x, durum: "okunuyor" } : x)))
        const sonuc = await dosyaGonder(k, sessionId)
        sessionId = sonuc.sessionId
        setKuyruk((q) => q.map((x) => (x.key === k.key ? sonuc.satir : x)))
        if (sonuc.satir.durum === "okundu" && sessionId) {
          setKuyrukOturumu(sessionId)
          setSeciliOturum(sessionId)
        }
      }
    } finally {
      setCalisiyor(false)
    }
  }, [kuyruk, kuyrukOturumu, dosyaGonder])

  const yineDeOku = useCallback(
    async (k: Kuyruk) => {
      setKuyruk((q) => q.map((x) => (x.key === k.key ? { ...x, durum: "okunuyor" } : x)))
      const sonuc = await dosyaGonder(k, kuyrukOturumu, { force: true })
      setKuyruk((q) => q.map((x) => (x.key === k.key ? sonuc.satir : x)))
      if (sonuc.satir.durum === "okundu" && sonuc.sessionId) {
        setKuyrukOturumu(sonuc.sessionId)
        setSeciliOturum(sonuc.sessionId)
      }
    },
    [dosyaGonder, kuyrukOturumu]
  )

  const kuyruguTemizle = useCallback(() => {
    setKuyruk([])
    setKuyrukOturumu(null)
  }, [])

  if (selectedCompany && selectedCompany.isMenuTaramaEnabled !== true) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Menü Tarama</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Menü tarama şu anda sınırlı sayıda firmayla yürütülen bir denemededir ve bu firma için açık değil.
          </CardContent>
        </Card>
      </div>
    )
  }

  const bekleyen = kuyruk.filter((k) => k.durum === "bekliyor").length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Menü Tarama</h1>
        <p className="text-sm text-muted-foreground">
          Basılı menünüzün fotoğrafını ya da PDF&apos;ini okutun; kalemler onaydan geçerek Restoran &amp; Kafe satış ekranında satılabilir ürüne dönüşür. Reçeteyi sonra kurarsınız.
        </p>
      </div>

      <ReadOnlyBanner />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Menü dosyaları</CardTitle>
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
                  Menü sayfalarını sürükleyin veya seçmek için tıklayın
                  <br />
                  <span className="text-xs">Fotoğraf (jpg/png/webp) ya da PDF · en çok {MAX_DOSYA} dosya · hepsi TEK menü sayılır</span>
                </span>
              </button>

              {kuyruk.length > 0 && (
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center justify-between text-muted-foreground">
                    <span>{kuyrukOturumu ? "Bu menüye eklenir" : "Yeni menü"}</span>
                    <button type="button" className="underline" onClick={kuyruguTemizle} disabled={calisiyor}>listeyi temizle · yeni menü</button>
                  </li>
                  {kuyruk.map((k) => (
                    <li key={k.key} className="flex items-center gap-2 rounded-md border border-kobipo-border px-2 py-1">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={k.dosya.name}>{k.dosya.name}</span>
                      {k.durum === "okunuyor" && <Loader2 className="h-3.5 w-3.5 animate-spin text-kobipo-blue" />}
                      {k.durum === "okundu" && <span className="font-semibold text-kobipo-green-dark">{k.kalem != null ? `${k.kalem} kalem` : "okundu"}</span>}
                      {k.durum === "hata" && <span className="truncate text-red-700" title={k.mesaj}>{k.mesaj}</span>}
                      {k.durum === "mukerrer" && (
                        <span className="flex items-center gap-1 text-amber-800">
                          daha önce okunmuş
                          {k.onceki?.sessionId && <button type="button" className="underline" onClick={() => setSeciliOturum(k.onceki!.sessionId)}>aç</button>}
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

              <div className="space-y-2 text-sm">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Yeni ürünlerde genel KDV</span>
                  <select value={kdv} onChange={(e) => setKdv(Number(e.target.value))} className="h-8 rounded-md border border-kobipo-border bg-background px-2 text-sm">
                    {KDV_ORANLARI.map((o) => <option key={o} value={o}>%{o}</option>)}
                  </select>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={tamami} onChange={(e) => setTamami(e.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>
                    Bu yüklenenler menünün <strong>tamamı</strong>
                    <span className="block text-xs text-muted-foreground">İşaretliyse sistemde olup menüde olmayan ürünler listelenir; yarım menüde işaretlemeyin.</span>
                  </span>
                </label>
              </div>

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
                <Button onClick={oku} disabled={bekleyen === 0 || calisiyor} className="w-full">
                  {calisiyor ? "Okunuyor…" : bekleyen > 1 ? `${bekleyen} dosyayı oku` : "Oku"}
                </Button>
              </WriteAction>

              <p className="text-xs text-muted-foreground">
                Dosyalar <strong>saklanmaz</strong>: okuma bittiğinde silinir, yalnız çıkarılan kalemler kutuda kalır. Menüdeki rakamlar KDV dahil kabul edilir.
              </p>
            </CardContent>
          </Card>

          {selectedCompanyId && <MenuGelenKutusu companyId={selectedCompanyId} seciliId={seciliOturum} onSec={setSeciliOturum} yenilemeAnahtari={kutuAnahtari} />}
        </div>

        <div className="space-y-4">
          {!seciliOturum && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Menü sayfalarını yükleyip <strong>Oku</strong>&apos;ya basın ya da soldaki listeden okunmuş bir menüyü açın. Okunan kalemler mevcut ürünlerle karşılaştırılır: yeni / fiyat değişmiş / aynı / menüde yok.
              </CardContent>
            </Card>
          )}
          {seciliOturum && selectedCompanyId && (
            <OturumKarti companyId={selectedCompanyId} sessionId={seciliOturum} yenilemeAnahtari={kutuAnahtari} onDegisti={() => setKutuAnahtari((n) => n + 1)} />
          )}
        </div>
      </div>
    </div>
  )
}
