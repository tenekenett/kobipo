"use client"

/**
 * Fotoğraf kırpma penceresi — sabit oranlı çerçeve, sürükle + yakınlaştır.
 *
 * NEDEN VAR: menü kartındaki görselin oranı sabit. Bunu CSS'e bırakmanın iki
 * yolu vardı ve ikisi de kötüydü — `object-fit: cover` DAİMA ortadan kırpar
 * (telefonla çekilen dikey şişe fotoğrafının kapağı da dibi de gider),
 * `contain` ise kenarlarda boşluk bırakır. İkisinin de ortak hatası kararı
 * yazılımın vermesi. Kullanıcı yüklemesi olan uygulamalar bu yüzden kırpmayı
 * YÜKLEME ANINDA, kullanıcıya yaptırır: özneyi çerçeveye o oturtur.
 *
 * Çıktı tam olarak çerçeve oranında ve sabit çözünürlükte olduğu için kart
 * tarafında kırpılacak bir şey kalmaz; ızgara birebir düzgün dizilir.
 *
 * Görüntü <img> yerine CANVAS ile çiziliyor: createImageBitmap'e EXIF yönünü
 * açıkça verip (telefon fotoğrafları dosyada yan durur) hem ekranda hem
 * çıktıda AYNI pikselleri kullanıyoruz — kullanıcı ne görüyorsa o kaydediliyor.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { canvasToImageFile } from "@/lib/images/encode-image"

/** Çerçevenin ekrandaki genişliği (CSS px). Yükseklik orandan türer. */
const FRAME_W = 448

/**
 * Kaydedilen çözünürlük. Kart en fazla ~450px genişlikte görünüyor; 2x ekranda
 * 900px eder. Daha büyüğü dosyayı şişirir, kartta karşılığı olmaz.
 */
const OUT_W = 900

/** Kullanıcı en fazla 4 kat yakınlaştırabilir — ötesi hamurlaşır. */
const MAX_ZOOM = 4

type Offset = { x: number; y: number }

export function ImageCropDialog({
  file,
  aspect = 3 / 2,
  onCancel,
  onDone,
}: {
  /** Kırpılacak dosya; null iken pencere kapalıdır. */
  file: File | null
  aspect?: number
  onCancel: () => void
  /** Kırpılmış, çerçeve oranında, WebP dosya. */
  onDone: (cropped: File) => void
}) {
  const frameH = Math.round(FRAME_W / aspect)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const dragRef = useRef<{ px: number; py: number } | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Çerçeveyi tam dolduran en küçük ölçek — yakınlaştırmanın alt sınırı. */
  const [minScale, setMinScale] = useState(1)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })

  /** Görüntü çerçeveyi HER ZAMAN doldursun: boşluk kalmasına izin yok. */
  const clampOffset = useCallback(
    (next: Offset, atScale: number): Offset => {
      const bmp = bitmapRef.current
      if (!bmp) return { x: 0, y: 0 }
      const maxX = Math.max(0, (bmp.width * atScale - FRAME_W) / 2)
      const maxY = Math.max(0, (bmp.height * atScale - frameH) / 2)
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      }
    },
    [frameH]
  )

  // Dosya değişince görseli çöz ve çerçeveyi dolduracak şekilde ortala.
  useEffect(() => {
    let cancelled = false
    bitmapRef.current?.close()
    bitmapRef.current = null
    setReady(false)
    setError(null)
    if (!file) return

    ;(async () => {
      try {
        // imageOrientation AÇIKÇA: telefonla çekilen fotoğraf dik görünse de
        // dosyada yan durur, doğru yön EXIF etiketindedir. Varsayılanın
        // "from-image" olduğu tarayıcılar var ama hepsinde değil.
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
        if (cancelled) {
          bmp.close()
          return
        }
        bitmapRef.current = bmp
        const cover = Math.max(FRAME_W / bmp.width, frameH / bmp.height)
        setMinScale(cover)
        setScale(cover)
        setOffset({ x: 0, y: 0 })
        setReady(true)
      } catch {
        if (!cancelled) {
          setError(
            "Bu fotoğraf tarayıcıda açılamadı. iPhone'dan geliyorsa HEIC olabilir — " +
              "paylaşırken JPEG seçin ya da ekran görüntüsünü kullanın."
          )
        }
      }
    })()

    return () => {
      cancelled = true
      // ImageBitmap çözülmüş pikselleri tutar (12 MP fotoğraf ~48 MB); bileşen
      // sökülürken çöp toplayıcıya bırakmayıp elle serbest bırakıyoruz.
      bitmapRef.current?.close()
      bitmapRef.current = null
    }
  }, [file, frameH])

  // Çizim: ölçek/konum her değiştiğinde çerçeveyi yeniden boya.
  useEffect(() => {
    const canvas = canvasRef.current
    const bmp = bitmapRef.current
    if (!canvas || !bmp || !ready) return

    // Retina'da bulanmasın: canvas piksel boyutu ekran yoğunluğuyla çarpılır.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = FRAME_W * dpr
    canvas.height = frameH * dpr

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, FRAME_W, frameH)
    ctx.imageSmoothingQuality = "high"

    const { left, top, w, h } = placement(bmp, scale, offset, frameH)
    ctx.drawImage(bmp, left, top, w, h)
  }, [ready, scale, offset, frameH])

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.px
    const dy = e.clientY - drag.py
    dragRef.current = { px: e.clientX, py: e.clientY }
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, scale))
  }

  function endDrag(e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function changeZoom(next: number) {
    const clamped = Math.min(minScale * MAX_ZOOM, Math.max(minScale, next))
    setScale(clamped)
    // Uzaklaşınca görüntü çerçeveden küçülüp boşluk bırakmasın diye konum
    // yeni ölçeğe göre yeniden sınırlanır.
    setOffset((o) => clampOffset(o, clamped))
  }

  async function handleSave() {
    const bmp = bitmapRef.current
    if (!bmp || !file) return
    setSaving(true)
    setError(null)
    try {
      const out = document.createElement("canvas")
      out.width = OUT_W
      out.height = Math.round(OUT_W / aspect)
      const ctx = out.getContext("2d")
      if (!ctx) throw new Error("Tarayıcı canvas desteklemiyor")
      ctx.imageSmoothingQuality = "high"

      // Ekrandaki yerleşimin aynısı, çıktı ölçeğine büyütülmüş hali. Böylece
      // kaydedilen kare, kullanıcının çerçevede gördüğünün BİREBİR aynısı olur.
      const k = OUT_W / FRAME_W
      const { left, top, w, h } = placement(bmp, scale, offset, frameH)
      ctx.drawImage(bmp, left * k, top * k, w * k, h * k)

      onDone(await canvasToImageFile(out, file.name))
    } catch (e: any) {
      setError(e?.message || "Fotoğraf kırpılamadı")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Fotoğrafı Çerçeveye Yerleştirin</DialogTitle>
          <DialogDescription>
            Sürükleyerek kaydırın, yakınlaştırma çubuğuyla büyütün. Çerçevede gördüğünüz
            alan menü kartında görünecek olan alandır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            className="relative mx-auto overflow-hidden rounded-xl bg-muted"
            style={{ width: FRAME_W, height: frameH, maxWidth: "100%" }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="h-full w-full touch-none select-none"
              style={{ cursor: ready ? "grab" : "default" }}
            />
            {!ready && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="mx-auto flex items-center gap-3" style={{ maxWidth: FRAME_W }}>
            <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="range"
              min={minScale}
              max={minScale * MAX_ZOOM}
              step={minScale / 100}
              value={scale}
              disabled={!ready}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-kobipo-blue dark:accent-primary"
              aria-label="Yakınlaştır"
            />
            <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!ready || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kullan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Görselin çerçeve içindeki yerleşimi — çerçevenin sol üstüne göre.
 * Ekran çizimi ile çıktı çizimi AYNI fonksiyonu kullanır; ayrı hesaplansaydı
 * kullanıcının gördüğü kare ile kaydedilen kare zamanla ayrışırdı.
 */
function placement(bmp: ImageBitmap, scale: number, offset: Offset, frameH: number) {
  const w = bmp.width * scale
  const h = bmp.height * scale
  return {
    w,
    h,
    left: FRAME_W / 2 + offset.x - w / 2,
    top: frameH / 2 + offset.y - h / 2,
  }
}
