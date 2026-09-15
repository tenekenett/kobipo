"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FileDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  belgeMetni,
  otomatikDegerler,
  sablonAlanlari,
  type BelgeFirma,
  type BelgePersonel,
} from "@/lib/personel/belge-alanlari"

/**
 * Şablondan belge basma penceresi.
 *
 * Solda CANLI ÖNİZLEME, sağda yalnız elle doldurulacak alanlar durur. Önizleme ile
 * PDF aynı fonksiyondan (`belgeMetni`) geçer — ekranda görünen ile imzaya giden belge
 * ayrışmamalı. PDF'i sunucu üretir (antet ve imza bloğu orada çizilir).
 *
 * PERSONEL SEÇİLİNCE sözlükteki alanlar kendiliğinden dolar; kullanıcı yalnız
 * belgeye özgü alanları yazar. Rakip üründe `{İşe Başlama Tarihi}` bile elle
 * yazılıyordu — veri kartta dururken.
 */

type Sablon = {
  id: string
  title: string
  body: string
}

type PersonelSatiri = {
  id: string
  firstName: string
  lastName: string
  status?: string
} & Partial<BelgePersonel>

export function BelgeOlusturDialog({
  open,
  companyId,
  sablon,
  onClose,
}: {
  open: boolean
  companyId: string
  sablon: Sablon | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const [personeller, setPersoneller] = useState<PersonelSatiri[]>([])
  const [firma, setFirma] = useState<BelgeFirma | null>(null)
  const [secilenId, setSecilenId] = useState<string>("")
  const [degerler, setDegerler] = useState<Record<string, string>>({})
  const [uretiliyor, setUretiliyor] = useState(false)

  const yukle = useCallback(async () => {
    if (!open || !companyId) return
    const [pRes, fRes] = await Promise.all([
      fetch(`/api/personel/employees?companyId=${companyId}`, { cache: "no-store" }),
      fetch(`/api/companies/${companyId}`, { cache: "no-store" }),
    ])
    const pData = await pRes.json().catch(() => null)
    const fData = await fRes.json().catch(() => null)
    const liste = Array.isArray(pData) ? pData : Array.isArray(pData?.data) ? pData.data : []
    setPersoneller(liste)
    setFirma(fData?.data ?? fData ?? null)
  }, [open, companyId])

  useEffect(() => {
    yukle()
  }, [yukle])

  useEffect(() => {
    if (!open) return
    setSecilenId("")
    setDegerler({})
  }, [open, sablon?.id])

  const secilen = personeller.find((p) => p.id === secilenId) ?? null

  // Önizleme PDF ile AYNI fonksiyondan geçer.
  const onizleme = useMemo(() => {
    if (!sablon || !firma) return ""
    return belgeMetni(
      sablon.body,
      { firma, personel: secilen ? (secilen as BelgePersonel) : null },
      degerler,
    )
  }, [sablon, firma, secilen, degerler])


  /**
   * KAYITTAN dolması gerekirken boş kalan alanlar.
   *
   * Elle alanların uyarısı yetmiyor: personel kartında işe giriş tarihi yoksa belge
   * "… tarihinden tarihine kadar …" diye basılıyor ve kullanıcı hiçbir uyarı
   * görmüyordu — rakip üründe tam da bu sessizlik, adı ve tarihi boş bir sözleşmenin
   * basılmasına yol açıyordu. Burası eksik olanı ADIYLA söyler ki kullanıcı personel
   * kartını tamamlasın.
   */
  const eksikKayit = useMemo(() => {
    if (!sablon || !firma) return []
    const otomatik = otomatikDegerler(sablon.body, {
      firma,
      personel: secilen ? (secilen as BelgePersonel) : null,
    })
    return Object.entries(otomatik)
      .filter(([, deger]) => !deger.trim())
      .map(([ad]) => ad)
  }, [sablon, firma, secilen])

  /**
   * Kutusu çizilecek alanlar: elle alanlar + kayıttan dolmayanlar.
   *
   * Boş kalan otomatik alan için de kutu açılır, çünkü `belgeMetni` elle girilen
   * değeri otomatiğin ÜSTÜNE yazıyor. Kutuyu açmamak, kullanıcıya "eksik" deyip
   * düzeltme yolu vermemek olurdu.
   */
  const doldurulacak = useMemo(() => {
    const tumu = sablon ? sablonAlanlari(sablon.body) : []
    return tumu.filter((a) => a.kaynak === "ELLE" || eksikKayit.includes(a.ad))
  }, [sablon, eksikKayit])

  /**
   * Şablona ÖZGÜ, hâlâ boş alanlar (tarih, gerekçe, tutar…).
   *
   * Kayıttan gelmesi gerekirken boş kalanlar buraya GİRMEZ: onların uyarısı ayrı ve
   * çözümü başka yerde (personel kartı). İkisi birleştirildiğinde aynı beş alan iki
   * kutuda birden sayılıyordu — uyarı çoğaldıkça okunmaz hâle gelir.
   */
  /**
   * Kırmızı uyarının listesi: kayıttan dolmayan VE kullanıcının da elle yazmadığı
   * alanlar.
   *
   * `eksikKayit`ten ayrı durmak zorunda: o liste hangi KUTULARIN çizileceğini
   * belirliyor ve `degerler`e bakmıyor — baksaydı kullanıcı yazmaya başlar başlamaz
   * alan listeden düşer, kutu DOM'dan kalkar ve odak uçardı.
   */
  const eksikKayitUyari = eksikKayit.filter((ad) => !degerler[ad]?.trim())

  const bosKalanlar = doldurulacak
    .filter((a) => a.kaynak === "ELLE" && !degerler[a.ad]?.trim())
    .map((a) => a.ad)

  const pdfUret = async () => {
    if (!sablon) return
    setUretiliyor(true)
    try {
      const res = await fetch(`/api/personel/belge-sablonlari/${sablon.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, employeeId: secilenId || null, degerler }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Sunucu ${res.status} döndürdü`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      // Sekme açıldıktan sonra serbest bırak: erken revoke edilirse boş sayfa açılır.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      toast({
        title: "Belge oluşturulamadı",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setUretiliyor(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sablon?.title ?? "Belge oluştur"}</DialogTitle>
          <DialogDescription>
            Personel seçin; ad, T.C. no, görev ve tarihler kayıttan dolar. Kalan alanları
            aşağıda doldurun.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Önizleme */}
          <div className="rounded-md border bg-background p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Önizleme</p>
            <div
              className="prose prose-sm max-w-none text-sm leading-relaxed dark:prose-invert [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
              // Güvenli: gövde kaydedilirken izin listesinden geçirildi
              // (belge-govde.ts → govdeTemizle), doldurma yalnız metin yerleştirir.
              dangerouslySetInnerHTML={{ __html: onizleme }}
            />
          </div>

          {/* Alanlar */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="belge-personel">Personel</Label>
              <Select value={secilenId || "yok"} onValueChange={(v) => setSecilenId(v === "yok" ? "" : v)}>
                <SelectTrigger id="belge-personel">
                  <SelectValue placeholder="Seçiniz" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yok">Personelsiz belge</SelectItem>
                  {personeller.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {doldurulacak.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Doldurulacak alanlar</p>
                {doldurulacak.map((a) => (
                  <div key={a.ad} className="space-y-1">
                    <Label htmlFor={`alan-${a.ad}`} className="text-xs">
                      {a.ad}
                    </Label>
                    <Input
                      id={`alan-${a.ad}`}
                      // Tip TEK yerden gelir; tarih alanı her belgede aynı biçimde
                      // girilir (rakipte aynı üründe iki farklı format dolaşıyordu).
                      type={a.tip === "TARIH" ? "date" : a.tip === "PARA" || a.tip === "SAYI" ? "number" : "text"}
                      step={a.tip === "PARA" ? "0.01" : undefined}
                      value={degerler[a.ad] ?? ""}
                      onChange={(e) =>
                        setDegerler((d) => ({
                          ...d,
                          [a.ad]:
                            a.tip === "TARIH" && e.target.value
                              ? new Date(e.target.value).toLocaleDateString("tr-TR")
                              : e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {eksikKayitUyari.length > 0 && (
              // Kayıttan dolması GEREKEN ama boş kalan alanlar. Çözümü bu ekranda
              // değil personel/firma kartındadır, o yüzden ayrı ve daha görünür.
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                Personel/firma kartında boş olduğu için dolmayan alanlar:{" "}
                <strong>{eksikKayitUyari.join(", ")}</strong>. Kartı tamamlayın ya da aşağıdan elle
                yazın — yoksa belgede boş görünürler.
              </p>
            )}

            {bosKalanlar.length > 0 && (
              // Belge eksik alanla da basılabilir (bazen bilerek boş bırakılır) ama
              // kullanıcı bunu BASMADAN ÖNCE görür. Rakipte tamamen boş bir sözleşme
              // sessizce kaydedilip "AD SOYAD :  TARİH :" diye basılıyordu.
              <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                Boş kalan alanlar: {bosKalanlar.join(", ")}. Belge yine de basılabilir, bu alanlar boş
                görünür.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          <Button onClick={pdfUret} disabled={uretiliyor || !sablon}>
            {uretiliyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            PDF oluştur
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
