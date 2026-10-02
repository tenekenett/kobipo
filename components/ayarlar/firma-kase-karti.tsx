"use client"

/**
 * Firma ayarlarındaki "Kaşe ve İmza" kartı — makbuz kaşesinin kalıcı yeri.
 *
 * Kaşe iki yoldan gelir: bilgisayardan yüklenir ya da e-Dönüşüm şablonlarındaki
 * kaşelerden biri seçilir (çoğu firma kaşesini oraya zaten yüklemiş). Ayarlarda kaşe
 * yoksa makbuz şablondaki kaşeyi basmaya devam eder; kart bunu "şu an basılan" satırında
 * söyler — kullanıcı kaşe yüklemeden makbuzda neden kaşe çıktığını merak etmesin.
 * Kural ve seçim sırası: `lib/company/stamp.ts`.
 */

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useToast } from "@/components/ui/use-toast"
import { Check, ImagePlus, Loader2, Stamp, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { downscaleImageToDataUrl } from "@/lib/labels/raster"
import { STAMP_MAX_HEIGHT_MM, STAMP_WIDTH_MM } from "@/lib/company/stamp"

type TemplateStamp = {
  templateId: string
  fromParent: boolean
  xsltName: string
  eDocumentType: number
  isActive: boolean
  dataUri: string
}

type StampState = {
  stamp: { dataUri: string; widthMm: number; updatedAt: string } | null
  templateStamps: TemplateStamp[]
  effective: { kind: "settings" | "template"; fromParent: boolean; templateName?: string } | null
}

/** Önizleme ölçeği: imza sütunu makbuzda ~84 mm. */
const PREVIEW_PX_PER_MM = 3
const SIGNATURE_COLUMN_MM = 84

const DOC_TYPE_LABEL: Record<number, string> = { 1: "e-Fatura", 2: "e-Arşiv" }

function effectiveText(state: StampState): string {
  const e = state.effective
  if (!e) return "Makbuzlar şu an kaşesiz basılıyor."
  if (e.kind === "settings") {
    return e.fromParent
      ? "Şubenin kaşesi yok — makbuzlarda ana firmanın kaşesi basılıyor."
      : "Makbuzlarda bu kaşe basılıyor."
  }
  const where = e.templateName ? `“${e.templateName}” şablonundaki` : "e-Dönüşüm şablonundaki"
  return e.fromParent
    ? `Ayarlarda kaşe yok — makbuzlarda ana firmanın ${where} kaşesi basılıyor.`
    : `Ayarlarda kaşe yok — makbuzlarda ${where} kaşe basılıyor.`
}

export function FirmaKaseKarti({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<StampState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [widthMm, setWidthMm] = useState<number>(STAMP_WIDTH_MM.default)

  const apply = (next: StampState) => {
    setState(next)
    setWidthMm(next.stamp?.widthMm ?? STAMP_WIDTH_MM.default)
  }

  useEffect(() => {
    let cancelled = false
    setState(null)
    setLoadError(null)
    fetch(`/api/firma-kasesi?companyId=${encodeURIComponent(companyId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "Kaşe bilgisi alınamadı")
        if (!cancelled) apply(data)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Kaşe bilgisi alınamadı")
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  /** PUT gövdesine firma eklenir; DELETE firmayı adreste taşır. */
  async function send(key: string, init: { method: "PUT" | "DELETE"; body?: object }, success: string) {
    setBusy(key)
    try {
      const res = await fetch(
        init.method === "DELETE"
          ? `/api/firma-kasesi?companyId=${encodeURIComponent(companyId)}`
          : "/api/firma-kasesi",
        {
          method: init.method,
          headers: { "Content-Type": "application/json" },
          body: init.body ? JSON.stringify({ companyId, ...init.body }) : undefined,
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      apply(data)
      toast({ title: success })
    } catch (error) {
      toast({
        title: "Kaşe kaydedilemedi",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  async function pickFile(file: File) {
    // Sunucu yine normalleştirir (kenar kırpma, PNG, 800 px); burada yalnız gövde
    // sınırına sığsın diye küçültülür.
    const dataUri = await downscaleImageToDataUrl(file, 1200)
    if (!dataUri) {
      toast({
        title: "Görsel yüklenemedi",
        description: "En fazla 2 MB boyutunda bir PNG/JPEG görsel seçin.",
        variant: "destructive",
      })
      return
    }
    await send("upload", { method: "PUT", body: { dataUri, widthMm } }, "Kaşe yüklendi")
  }

  async function remove() {
    const ok = await confirm({
      title: "Kaşeyi kaldır",
      description:
        state?.templateStamps.length
          ? "Ayarlardaki kaşe silinir; makbuzlar e-Dönüşüm şablonundaki kaşeyi basmaya döner."
          : "Ayarlardaki kaşe silinir; makbuzlar kaşesiz basılır.",
      confirmLabel: "Kaldır",
    })
    if (!ok) return
    await send("remove", { method: "DELETE" }, "Kaşe kaldırıldı")
  }

  const savedWidth = state?.stamp?.widthMm ?? STAMP_WIDTH_MM.default
  const previewSrc = state?.stamp?.dataUri ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-muted-foreground" />
          Kaşe ve İmza
        </CardTitle>
        <CardDescription>
          Tahsilat, ödeme ve virman makbuzlarında firmanın imza alanına basılır.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!state && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        )}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {state && (
          <>
            <p className="text-sm text-muted-foreground">{effectiveText(state)}</p>

            <div className="flex flex-col gap-5 md:flex-row md:items-start">
              {/* Makbuzdaki görünüm, ölçekli: imza sütunu + seçilen genişlik. */}
              <div className="shrink-0">
                <Label className="mb-1.5 block">Makbuzda görünümü</Label>
                <div
                  className="rounded-md border bg-white p-3"
                  style={{ width: SIGNATURE_COLUMN_MM * PREVIEW_PX_PER_MM + 26, maxWidth: "100%" }}
                >
                  <div
                    className="flex items-end justify-center"
                    style={{ minHeight: 36, maxWidth: "100%", width: SIGNATURE_COLUMN_MM * PREVIEW_PX_PER_MM }}
                  >
                    {previewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewSrc}
                        alt="Firma kaşesi"
                        className="object-contain"
                        style={{
                          width: widthMm * PREVIEW_PX_PER_MM,
                          maxWidth: "100%",
                          maxHeight: STAMP_MAX_HEIGHT_MM * PREVIEW_PX_PER_MM,
                        }}
                      />
                    ) : (
                      <span className="pb-2 text-xs text-muted-foreground">Ayarlarda kaşe yok</span>
                    )}
                  </div>
                  <div className="mt-1 border-t border-slate-300 pt-1 text-center text-[11px] text-slate-600">
                    Düzenleyen / Teslim Alan
                  </div>
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-4">
                {state.stamp && (
                  <div className="space-y-1.5">
                    <Label htmlFor="kase-genislik">Basım genişliği: {widthMm} mm</Label>
                    <input
                      id="kase-genislik"
                      type="range"
                      min={STAMP_WIDTH_MM.min}
                      max={STAMP_WIDTH_MM.max}
                      step={1}
                      value={widthMm}
                      onChange={(e) => setWidthMm(Number(e.target.value))}
                      className="w-full max-w-xs accent-primary"
                    />
                    {widthMm !== savedWidth && (
                      <WriteAction>
                        <Button
                          type="button"
                          size="sm"
                          variant="success"
                          disabled={busy !== null}
                          onClick={() =>
                            send("width", { method: "PUT", body: { widthMm } }, "Kaşe boyutu kaydedildi")
                          }
                        >
                          {busy === "width" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Boyutu kaydet
                        </Button>
                      </WriteAction>
                    )}
                  </div>
                )}

                <WriteAction>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {busy === "upload" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-2 h-4 w-4" />
                      )}
                      {state.stamp ? "Bilgisayardan değiştir" : "Bilgisayardan yükle"}
                    </Button>
                    {state.stamp && (
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={remove}>
                        {busy === "remove" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Kaldır
                      </Button>
                    )}
                  </div>
                </WriteAction>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void pickFile(f)
                    e.target.value = ""
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  PNG/JPEG, en fazla 2 MB. Saydam zeminli PNG en iyi sonucu verir; kenardaki boşluk
                  otomatik kırpılır.
                </p>
              </div>
            </div>

            {state.templateStamps.length > 0 && (
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-medium">e-Dönüşüm şablonlarındaki kaşeler</p>
                  <p className="text-xs text-muted-foreground">
                    Fatura şablonuna yüklediğiniz kaşeyi makbuzlarda da kullanmak için seçin.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {state.templateStamps.map((t) => {
                    const inUse = busy === `tpl:${t.templateId}`
                    return (
                      <WriteAction
                        key={t.templateId}
                        fallback={
                          <div className="rounded-md border p-2">
                            <TemplateStampTile t={t} />
                          </div>
                        }
                      >
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            send(
                              `tpl:${t.templateId}`,
                              { method: "PUT", body: { templateId: t.templateId, widthMm } },
                              "Şablondaki kaşe alındı",
                            )
                          }
                          className={cn(
                            "rounded-md border p-2 text-left transition hover:border-primary hover:bg-muted/40",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                          )}
                        >
                          <TemplateStampTile t={t} />
                          <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary">
                            {inUse ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Bu kaşeyi kullan
                          </span>
                        </button>
                      </WriteAction>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TemplateStampTile({ t }: { t: TemplateStamp }) {
  return (
    <>
      <div className="flex h-20 items-center justify-center rounded bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.dataUri} alt={t.xsltName} className="max-h-full max-w-full object-contain" />
      </div>
      <p className="mt-1.5 truncate text-xs font-medium" title={t.xsltName}>
        {t.xsltName}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {DOC_TYPE_LABEL[t.eDocumentType] ?? "Şablon"}
        {t.isActive ? " · aktif" : ""}
        {t.fromParent ? " · ana firma" : ""}
      </p>
    </>
  )
}
