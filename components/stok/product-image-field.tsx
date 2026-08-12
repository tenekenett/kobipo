"use client"

/**
 * Ürün fotoğrafı seçici — önizleme + seç/değiştir/kaldır.
 *
 * İki yerden kullanılıyor: yeni menü ürünü diyaloğu (ürünün henüz id'si yok) ve
 * mevcut ürünün fotoğraf diyaloğu. İkisi de AYNI akışı izler — önce dosya
 * yüklenir, `onChange` dönen URL'i alır; URL'i ürüne yazmak ÇAĞIRANIN işidir.
 * Bileşenin ürün id'sini bilmemesi, ürün yaratılmadan da fotoğraf seçilebilmesini
 * sağlıyor.
 *
 * Dosya seçilir seçilmez kırpma penceresi açılır (image-crop-dialog): kullanıcı
 * özneyi 3:2 çerçeveye kendisi oturtur, cihazdan çıkan dosya zaten kart oranında
 * ve WebP olur. Doğrudan yükleme YOK — aksi halde kart tarafında ya ortadan
 * kırpmak (dikey fotoğrafın kapağı gider) ya da boşluk bırakmak gerekirdi.
 */

import { useRef, useState } from "react"
import { ImagePlus, Loader2, Trash2, Utensils } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImageCropDialog } from "@/components/stok/image-crop-dialog"
import { cn } from "@/lib/utils"

/** Seçicide kabul edilenler; sunucu listesiyle aynı (SVG yok — depolanmış XSS). */
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif"

export function ProductImageField({
  companyId,
  value,
  onChange,
  disabled,
  className,
}: {
  companyId: string
  value: string | null
  /** Yükleme bitince yeni URL, "Kaldır"da null. Kaydetmek çağırana ait. */
  onChange: (url: string | null) => void | Promise<void>
  disabled?: boolean
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Seçilmiş ama henüz kırpılmamış dosya — kırpma penceresini o açar. */
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  /** Kırpma penceresinden çıkan dosyayı yükler; gelen dosya zaten 3:2 WebP. */
  async function uploadCropped(cropped: File) {
    setPendingFile(null)
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("companyId", companyId)
      fd.append("file", cropped)

      const res = await fetch("/api/stok/products/image", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}) as any)
      if (!res.ok) throw new Error(data?.error || "Görsel yüklenemedi")

      await onChange(data.url as string)
    } catch (e: any) {
      setError(e?.message || "Görsel yüklenemedi")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      await onChange(null)
    } catch (e: any) {
      setError(e?.message || "Fotoğraf kaldırılamadı")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        title={value ? "Fotoğrafı değiştir" : "Fotoğraf seç"}
        className={cn(
          // Kart bandıyla AYNI oran (3:2): önizlemede görülen çerçeve, satış
          // ekranındaki kartın çerçevesinin aynısı olsun.
          "relative flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 transition-colors",
          value
            ? "border-border"
            : "border-dashed border-border text-muted-foreground hover:border-kobipo-blue hover:text-kobipo-blue dark:hover:border-primary dark:hover:text-primary",
          (disabled || busy) && "cursor-not-allowed opacity-60"
        )}
      >
        {value ? (
          /* Depo URL'i: next/image için remotePatterns yapılandırması gerekirdi
             ve görsel zaten tek boyutta saklanıyor — optimize edecek bir şey yok. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-7 w-7" />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
      </button>

      <div className="min-w-0 space-y-1.5 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
          >
            {value ? "Değiştir" : "Fotoğraf Seç"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={disabled || busy}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5 text-red-500" />
              Kaldır
            </Button>
          )}
        </div>

        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Utensils className="h-3 w-3 shrink-0" />
            Satış ve Adisyon ekranındaki menü kartında görünür
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          setPendingFile(f)
          // Aynı dosya tekrar seçilebilsin: input değeri değişmezse onChange
          // atmaz, kullanıcı kırpmadan vazgeçip aynı fotoğrafı seçemezdi.
          e.target.value = ""
        }}
      />

      <ImageCropDialog
        file={pendingFile}
        onCancel={() => setPendingFile(null)}
        onDone={(cropped) => void uploadCropped(cropped)}
      />
    </div>
  )
}
