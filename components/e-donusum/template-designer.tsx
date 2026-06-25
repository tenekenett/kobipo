"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import {
  DESIGN_FONTS,
  DENSITY_OPTIONS,
  MARGIN_OPTIONS,
  TABLE_HEADER_OPTIONS,
  DEFAULT_DESIGN_OPTIONS,
  MAX_LOGO_DATA_URI_LEN,
  MAX_FOOTER_NOTE_LEN,
  contrastText,
  tint,
  type TemplateDesignOptions,
  type TableHeaderStyle,
  type Density,
  type PageMargin,
} from "@/lib/integrations/e-invoice/template-designer"
import { ExternalLink, Eye, Hash, ImageIcon, Landmark, Loader2, Palette, Plus, RotateCcw, Save, Sparkles, Stamp, Upload, X } from "lucide-react"

const ASSIGN_NEW = "__new__"
const ASSIGN_SKIP = "__skip__"
const sanitizePrefix = (raw: string) =>
  raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 3)

interface AssignNumerator {
  prefix: string
  edocumentType: string
  isPassive: boolean
}

// Mysoft edocumentType'ı numeric ("1","2") veya enum adı dönebiliyor.
const numeratorMatchesDocType = (n: AssignNumerator, docType: number) => {
  const t = String(n.edocumentType || "").toUpperCase()
  if (docType === 1) return t === "1" || t === "EFATURA"
  if (docType === 2) return t === "2" || t === "10" || t === "EARSIVFATURA" || t === "GIBEARSIVFATURA"
  return false
}

/** Yüklenen görseli en fazla `maxDim` px'e küçültüp PNG data URI döndürür. */
function downscaleImage(file: File, maxDim = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Dosya okunamadı"))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Görsel çözümlenemedi"))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("Canvas desteklenmiyor"))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL("image/png"))
      }
      img.src = typeof reader.result === "string" ? reader.result : ""
    }
    reader.readAsDataURL(file)
  })
}

interface TemplateDesignerProps {
  companyId: string
  /** 1 = E-Fatura, 2 = E-Arşiv */
  docType: number
  docLabel: string
  /** Bu belge tipinde firmanın kullanımdaki (aktif) prefix'i — atama diyaloğunda işaretlenir. */
  activePrefix?: string
  /** Mysoft'a kaydedildikten sonra tanımlı şablon listesini tazelemek için. */
  onSaved?: () => void
}

const COLOR_PRESETS = ["#185FA5", "#0C3B6B", "#2D6A4F", "#7C3AED", "#B91C1C", "#0F766E", "#C2410C", "#1F2937"]

/** Hazır tema setleri — tek tıkla bütüncül görünüm. */
const THEME_PRESETS: Array<{ key: string; label: string; patch: Partial<TemplateDesignOptions> }> = [
  {
    key: "kurumsal-mavi",
    label: "Kurumsal Mavi",
    patch: { accentColor: "#185FA5", secondaryColor: "#0C3B6B", textColor: "#1A1A1A", pageBackground: "#FFFFFF", tableHeader: "accent", zebraRows: true, fontKey: "tahoma" },
  },
  {
    key: "zarif-yesil",
    label: "Zarif Yeşil",
    patch: { accentColor: "#2D6A4F", secondaryColor: "#1B4332", textColor: "#1A1A1A", pageBackground: "#FFFFFF", tableHeader: "accent", zebraRows: true, fontKey: "georgia" },
  },
  {
    key: "minimal-gri",
    label: "Minimal Gri",
    patch: { accentColor: "#1F2937", secondaryColor: "#374151", textColor: "#111827", pageBackground: "#FFFFFF", tableHeader: "light", zebraRows: false, fontKey: "arial" },
  },
  {
    key: "sicak-turuncu",
    label: "Sıcak Turuncu",
    patch: { accentColor: "#C2410C", secondaryColor: "#7C2D12", textColor: "#1A1A1A", pageBackground: "#FFF7ED", tableHeader: "accent", zebraRows: true, fontKey: "trebuchet" },
  },
  {
    key: "gece-lacivert",
    label: "Gece Lacivert",
    patch: { accentColor: "#0C3B6B", secondaryColor: "#185FA5", textColor: "#1A1A1A", pageBackground: "#F8FAFC", tableHeader: "accent", zebraRows: true, fontKey: "calibri" },
  },
]

export function TemplateDesigner({ companyId, docType, docLabel, activePrefix, onSaved }: TemplateDesignerProps) {
  const { toast } = useToast()

  const [opts, setOpts] = useState<TemplateDesignOptions>({ ...DEFAULT_DESIGN_OPTIONS })
  const [xsltName, setXsltName] = useState("")
  const [isHasLogo, setIsHasLogo] = useState(false)
  const [isHasStamp, setIsHasStamp] = useState(false)

  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const busy = isPreviewing || isSaving
  const logoInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)
  // Gerçek PDF önizlemesi (Mysoft'tan) — iframe içinde gösterilir.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<"approx" | "pdf">("approx")

  // Yüklü PDF object URL'sini bileşen kaldırılırken serbest bırak.
  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
  }, [pdfUrl])

  // Alt bilgiye eklemek için firmanın kayıtlı banka hesapları.
  const [bankAccounts, setBankAccounts] = useState<
    Array<{ id: string; name: string; bankName: string | null; accountNumber: string | null; iban: string | null }>
  >([])

  useEffect(() => {
    if (!companyId) return
    let active = true
    fetch(`/api/finans/accounts?companyId=${companyId}&type=BANK`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (active && Array.isArray(data)) setBankAccounts(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [companyId])

  // Seçilen banka hesabını alt bilgiye yeni satır olarak ekler (not metni korunur).
  const insertBankAccount = (id: string) => {
    const acc = bankAccounts.find((a) => a.id === id)
    if (!acc) return
    const parts = [acc.bankName || acc.name]
    if (acc.iban) parts.push(`IBAN: ${acc.iban.replace(/\s+/g, "").toUpperCase()}`)
    else if (acc.accountNumber) parts.push(`Hesap No: ${acc.accountNumber}`)
    const line = parts.filter(Boolean).join(" — ")
    setOpts((prev) => {
      const existing = prev.footerNote.trim()
      const next = existing ? `${existing}\n${line}` : line
      return { ...prev, footerNote: next.slice(0, MAX_FOOTER_NOTE_LEN) }
    })
  }

  // Kaydetme sonrası "şablonu bir seri no'ya ata" diyaloğu.
  const [assignOpen, setAssignOpen] = useState(false)
  const [savedXsltName, setSavedXsltName] = useState("")
  const [assignNumerators, setAssignNumerators] = useState<AssignNumerator[]>([])
  const [assignChoice, setAssignChoice] = useState<string>(ASSIGN_SKIP) // prefix | ASSIGN_NEW | ASSIGN_SKIP
  const [assignNewPrefix, setAssignNewPrefix] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)

  const set = <K extends keyof TemplateDesignOptions>(key: K, value: TemplateDesignOptions[K]) =>
    setOpts((prev) => ({ ...prev, [key]: value }))

  const onImageFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "logoDataUri" | "stampDataUri",
    ref: React.RefObject<HTMLInputElement | null>,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: "Geçersiz dosya", description: "Lütfen bir görsel (PNG/JPG) seçin.", variant: "destructive" })
      return
    }
    try {
      const dataUri = await downscaleImage(file)
      if (dataUri.length > MAX_LOGO_DATA_URI_LEN) {
        toast({ title: "Görsel çok büyük", description: "Daha küçük/sade bir görsel deneyin.", variant: "destructive" })
        return
      }
      setOpts((prev) => ({ ...prev, [target]: dataUri }))
    } catch (err) {
      toast({ title: "Yüklenemedi", description: err instanceof Error ? err.message : "Hata", variant: "destructive" })
    } finally {
      if (ref.current) ref.current.value = ""
    }
  }

  /** Tasarım seçeneklerinden üretilmiş XSLT içeriğini getirir. */
  const generateContent = async (): Promise<string | null> => {
    const res = await fetch("/api/e-donusum/templates/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, eDocumentType: docType, options: opts }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || typeof data?.content !== "string") {
      throw new Error(data?.error || "Tasarım oluşturulamadı")
    }
    return data.content
  }

  /** Gerçek PDF'i Mysoft'tan üretip iframe için object URL döndürür. */
  const fetchPdfBlobUrl = async (): Promise<string | null> => {
    const content = await generateContent()
    if (!content) return null
    const res = await fetch("/api/e-donusum/templates/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, eDocumentType: docType, content }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || "Önizleme alınamadı")
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  /** Gerçek PDF önizlemesini sağ panelde (iframe) yükler. */
  const preview = async () => {
    setIsPreviewing(true)
    try {
      const url = await fetchPdfBlobUrl()
      if (!url) return
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setPreviewMode("pdf")
    } catch (error) {
      toast({ title: "Önizleme hatası", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setIsPreviewing(false)
    }
  }

  /** Gerçek PDF'i yeni sekmede açar. */
  const openPdfNewTab = async () => {
    setIsPreviewing(true)
    try {
      const url = await fetchPdfBlobUrl()
      if (!url) return
      window.open(url, "_blank")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      toast({ title: "Önizleme hatası", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setIsPreviewing(false)
    }
  }

  const save = async () => {
    if (!xsltName.trim()) {
      toast({ title: "Şablon adı gerekli", description: "Tasarımınıza bir ad verin.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const content = await generateContent()
      if (!content) return
      const res = await fetch("/api/e-donusum/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: xsltName.trim(), content, isHasLogo, isHasStamp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Tasarım kaydedilemedi")

      // Tasarım seçeneklerini Kobipo'da sakla (kayıtlı şablon önizlemesi/aktif-yapma için).
      // Mysoft kaydı başarılı olduğundan bu adım başarısız olsa bile yumuşak geçeriz.
      try {
        await fetch("/api/e-donusum/templates/designs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: xsltName.trim(), options: opts }),
        })
      } catch {
        /* sessiz geç — Mysoft kaydı zaten yapıldı */
      }

      toast({ title: "Tasarım kaydedildi", description: data?.message || "Mysoft hesabınıza tanımlandı." })
      const savedName = xsltName.trim()
      setXsltName("")
      onSaved?.()
      // Kaydetme sonrası: bu şablonu bir seri no'ya atama diyaloğunu aç (isteğe bağlı).
      openAssignDialog(savedName)
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  // Kaydedilen şablonu bir seri no'ya (prefix) atama diyaloğunu açar ve mevcut
  // numaratörleri çeker. Kullanıcı dilerse mevcut bir prefix'e atar, yeni bir
  // prefix ekleyip atar ya da "Şimdilik boş bırak" der.
  const openAssignDialog = async (name: string) => {
    setSavedXsltName(name)
    // Kullanımdaki seri varsa onu ön-seçili getir (kullanıcı görsün); yoksa boş bırak.
    setAssignChoice(activePrefix ? activePrefix : ASSIGN_SKIP)
    setAssignNewPrefix("")
    setAssignNumerators([])
    setAssignOpen(true)
    try {
      const res = await fetch(`/api/e-donusum/numerators?companyId=${companyId}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.data)) {
        const list: AssignNumerator[] = data.data.filter(
          (n: AssignNumerator) => numeratorMatchesDocType(n, docType) && !n.isPassive,
        )
        setAssignNumerators(list)
        // Aktif prefix listede yoksa ön-seçimi boşa al (geçersiz seçim kalmasın).
        if (activePrefix && !list.some((n) => n.prefix === activePrefix)) {
          setAssignChoice(ASSIGN_SKIP)
        }
      }
    } catch {
      /* numaratör çekilemediyse kullanıcı yeni prefix ile devam edebilir */
    }
  }

  const confirmAssign = async () => {
    if (assignChoice === ASSIGN_SKIP) {
      setAssignOpen(false)
      return
    }
    const prefix =
      assignChoice === ASSIGN_NEW ? sanitizePrefix(assignNewPrefix) : assignChoice
    if (!prefix || prefix.length !== 3) {
      toast({ title: "Geçersiz seri no", description: "Prefix tam olarak 3 karakter olmalı.", variant: "destructive" })
      return
    }
    setIsAssigning(true)
    try {
      // Yeni prefix seçildiyse önce Mysoft'a numaratör olarak ekle.
      if (assignChoice === ASSIGN_NEW) {
        const addRes = await fetch("/api/e-donusum/numerators", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, prefix, eDocumentType: docType, isDefault: false }),
        })
        const addData = await addRes.json().catch(() => ({}))
        if (!addRes.ok) throw new Error(addData?.error || "Yeni seri no eklenemedi")
      }
      // Şablonu prefix'e ata.
      const res = await fetch("/api/e-donusum/series-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, prefix, xsltName: savedXsltName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon atanamadı")
      toast({
        title: "Şablon seri no'ya atandı",
        description: `"${prefix}" seri no'su artık "${savedXsltName}" şablonunu kullanacak.`,
      })
      setAssignOpen(false)
      onSaved?.()
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setIsAssigning(false)
    }
  }

  /* --- türetilmiş önizleme değerleri --- */
  const fontStack = DESIGN_FONTS.find((f) => f.key === opts.fontKey)?.stack ?? DESIGN_FONTS[0].stack
  const onAccent = contrastText(opts.accentColor)
  const cellPad = DENSITY_OPTIONS.find((d) => d.key === opts.density)?.padding ?? "3px 5px"
  const headerStyle =
    opts.tableHeader === "accent"
      ? { backgroundColor: opts.accentColor, color: onAccent }
      : opts.tableHeader === "light"
        ? { backgroundColor: tint(opts.accentColor, 0.86), color: opts.textColor }
        : { backgroundColor: "transparent", color: opts.textColor }
  const headingTransform = opts.headingTransform === "uppercase" ? ("uppercase" as const) : ("none" as const)

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Palette className="h-4 w-4" />
          </span>
          <div>
            <CardTitle>Kendi Tasarımını Oluştur</CardTitle>
            <CardDescription>
              <span className="font-medium text-foreground">{docLabel}</span> görünümünü baştan tasarlayın. Kobipo, GİB
              uyumlu taban şablonun üzerine temanızı uygular — fatura içeriği ve alanları değişmez.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)]">
          {/* SOL — sekmeli kontroller */}
          <Tabs defaultValue="tema" className="min-w-0">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="tema">Tema</TabsTrigger>
              <TabsTrigger value="renkler">Renkler</TabsTrigger>
              <TabsTrigger value="yazi">Yazı</TabsTrigger>
              <TabsTrigger value="logo">Logo &amp; Kaşe</TabsTrigger>
              <TabsTrigger value="tablo">Tablo &amp; Düzen</TabsTrigger>
              <TabsTrigger value="altbilgi">Alt Bilgi</TabsTrigger>
            </TabsList>

            {/* TEMA */}
            <TabsContent value="tema" className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Hazır tema
                </Label>
                <button
                  type="button"
                  onClick={() => setOpts({ ...DEFAULT_DESIGN_OPTIONS })}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Sıfırla
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setOpts((prev) => ({ ...prev, ...p.patch }))}
                    disabled={busy}
                    className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm font-medium transition hover:border-kobipo-blue hover:bg-muted/40 disabled:opacity-60"
                  >
                    <span className="flex gap-0.5">
                      <span className="h-5 w-2.5 rounded-l-sm" style={{ backgroundColor: p.patch.accentColor }} />
                      <span className="h-5 w-2.5 rounded-r-sm" style={{ backgroundColor: p.patch.secondaryColor }} />
                    </span>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Bir temayı taban alın, sonra diğer sekmelerden ince ayar yapın.
              </p>
            </TabsContent>

            {/* RENKLER */}
            <TabsContent value="renkler" className="space-y-4 pt-2">
              <ColorField label="Marka rengi" value={opts.accentColor} onChange={(v) => set("accentColor", v)} presets={COLOR_PRESETS} disabled={busy} />
              <div className="grid gap-3 sm:grid-cols-2">
                <ColorField label="İkincil renk" value={opts.secondaryColor} onChange={(v) => set("secondaryColor", v)} disabled={busy} />
                <ColorField label="Metin rengi" value={opts.textColor} onChange={(v) => set("textColor", v)} disabled={busy} />
                <ColorField label="Sayfa arka planı" value={opts.pageBackground} onChange={(v) => set("pageBackground", v)} disabled={busy} />
                <ColorField label="Tablo çizgi rengi" value={opts.tableBorderColor} onChange={(v) => set("tableBorderColor", v)} disabled={busy} />
              </div>
            </TabsContent>

            {/* YAZI */}
            <TabsContent value="yazi" className="space-y-4 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="design-font">Yazı tipi</Label>
                  <select
                    id="design-font"
                    value={opts.fontKey}
                    onChange={(e) => set("fontKey", e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    {DESIGN_FONTS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Başlık dönüşümü</Label>
                  <SegmentedControl
                    value={opts.headingTransform}
                    onChange={(v) => set("headingTransform", v as "uppercase" | "none")}
                    disabled={busy}
                    options={[
                      { key: "none", label: "Normal" },
                      { key: "uppercase", label: "BÜYÜK" },
                    ]}
                  />
                </div>
              </div>
              <RangeField label="Yazı boyutu" value={opts.baseFontSize} suffix="px" min={8} max={16} step={1} onChange={(v) => set("baseFontSize", v)} disabled={busy} />
              <RangeField label="Başlık ölçeği" value={opts.titleScale} suffix="×" min={1} max={2.2} step={0.1} onChange={(v) => set("titleScale", v)} disabled={busy} />
              <RangeField label="Satır yüksekliği" value={opts.lineHeight} suffix="×" min={1} max={2} step={0.1} onChange={(v) => set("lineHeight", v)} disabled={busy} />
            </TabsContent>

            {/* LOGO & KAŞE */}
            <TabsContent value="logo" className="space-y-5 pt-2">
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => onImageFile(e, "logoDataUri", logoInputRef)} disabled={busy} className="hidden" />
              <input ref={stampInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => onImageFile(e, "stampDataUri", stampInputRef)} disabled={busy} className="hidden" />

              <ImageUpload
                title="Firma Logosu"
                icon={<ImageIcon className="h-4 w-4 text-muted-foreground" />}
                dataUri={opts.logoDataUri}
                onPick={() => logoInputRef.current?.click()}
                onClear={() => set("logoDataUri", "")}
                width={opts.logoWidth}
                height={opts.logoHeight}
                onWidth={(v) => set("logoWidth", v)}
                onHeight={(v) => set("logoHeight", v)}
                widthRange={[40, 280]}
                heightRange={[24, 160]}
                hint="PNG/JPG · faturanın üst köşesine yerleşir"
                disabled={busy}
              />

              <ImageUpload
                title="Kaşe / Mühür"
                icon={<Stamp className="h-4 w-4 text-muted-foreground" />}
                dataUri={opts.stampDataUri}
                onPick={() => stampInputRef.current?.click()}
                onClear={() => set("stampDataUri", "")}
                width={opts.stampWidth}
                height={opts.stampHeight}
                onWidth={(v) => set("stampWidth", v)}
                onHeight={(v) => set("stampHeight", v)}
                widthRange={[40, 240]}
                heightRange={[40, 240]}
                hint="Şeffaf PNG önerilir"
                disabled={busy}
              />

              <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={isHasLogo} onChange={(e) => setIsHasLogo(e.target.checked)} disabled={busy} className="h-4 w-4 rounded border accent-kobipo-blue dark:accent-primary" />
                  Mysoft logo tanımı da kullanılsın
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={isHasStamp} onChange={(e) => setIsHasStamp(e.target.checked)} disabled={busy} className="h-4 w-4 rounded border accent-kobipo-blue dark:accent-primary" />
                  Mysoft kaşe tanımı da kullanılsın
                </label>
              </div>
            </TabsContent>

            {/* TABLO & DÜZEN */}
            <TabsContent value="tablo" className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Başlık şeridi</Label>
                <SegmentedControl value={opts.tableHeader} onChange={(v) => set("tableHeader", v as TableHeaderStyle)} disabled={busy} options={TABLE_HEADER_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Hücre yoğunluğu</Label>
                  <SegmentedControl value={opts.density} onChange={(v) => set("density", v as Density)} disabled={busy} options={DENSITY_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Kenar boşluğu</Label>
                  <SegmentedControl value={opts.pageMargin} onChange={(v) => set("pageMargin", v as PageMargin)} disabled={busy} options={MARGIN_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
                </div>
              </div>
              <RangeField label="Vurgu çizgisi kalınlığı" value={opts.lineThickness} suffix="px" min={1} max={6} step={1} onChange={(v) => set("lineThickness", v)} disabled={busy} />
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={opts.zebraRows} onChange={(e) => set("zebraRows", e.target.checked)} disabled={busy} className="h-4 w-4 rounded border accent-kobipo-blue dark:accent-primary" />
                Satırları şeritli (zebra) göster
              </label>
            </TabsContent>

            {/* ALT BİLGİ */}
            <TabsContent value="altbilgi" className="space-y-3 pt-2">
              {/* Kayıtlı banka hesabından hızlı ekleme */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Landmark className="h-3.5 w-3.5" /> Banka hesabı ekle
                </Label>
                {bankAccounts.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) insertBankAccount(e.target.value)
                    }}
                    disabled={busy}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Banka hesabı seçin (nota eklenir)…</option>
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.bankName || a.name}
                        {a.iban ? ` — ${a.iban}` : a.accountNumber ? ` — ${a.accountNumber}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Kayıtlı banka hesabınız yok. <span className="font-medium text-foreground">Finans → Kanallar</span>'dan
                    ekleyebilir, sonra buradan seçebilirsiniz.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="footer-note">Fatura altı not (IBAN, banka, teşekkür…)</Label>
                <Textarea
                  id="footer-note"
                  value={opts.footerNote}
                  onChange={(e) => set("footerNote", e.target.value.slice(0, MAX_FOOTER_NOTE_LEN))}
                  disabled={busy}
                  rows={5}
                  placeholder={"ör.\nBanka: Örnek Bankası — TR12 0000 0000 0000 0000 0000 00\nBizi tercih ettiğiniz için teşekkür ederiz."}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Yukarıdan banka hesabı seçince nota eklenir; serbestçe de yazabilirsiniz.</span>
                  <span>{opts.footerNote.length}/{MAX_FOOTER_NOTE_LEN}</span>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* SAĞ — önizleme (yapışkan): yaklaşık şema veya gerçek PDF */}
          <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center justify-between gap-2">
              <Label>Önizleme</Label>
              <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewMode("approx")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${previewMode === "approx" ? "bg-kobipo-blue text-white shadow-sm dark:bg-primary dark:text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Şema
                </button>
                <button
                  type="button"
                  onClick={() => (pdfUrl ? setPreviewMode("pdf") : preview())}
                  disabled={busy}
                  className={`rounded-md px-2.5 py-1 font-medium transition disabled:opacity-60 ${previewMode === "pdf" ? "bg-kobipo-blue text-white shadow-sm dark:bg-primary dark:text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {isPreviewing ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : "Gerçek PDF"}
                </button>
              </div>
            </div>

            {previewMode === "pdf" ? (
              <div className="space-y-2">
                {pdfUrl ? (
                  <iframe title="Gerçek PDF önizleme" src={pdfUrl} className="h-[640px] w-full rounded-xl border bg-white shadow-sm" />
                ) : (
                  <div className="flex h-[640px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Mysoft üzerinden PDF üretiliyor…
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Bu, faturanın gerçek çıktısıdır.</p>
                  <Button variant="ghost" size="sm" onClick={preview} disabled={busy}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Yenile
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Yaklaşık ŞEMA — gerçek Mysoft düzenine benzer kurgulanmıştır */}
                <div
                  className="relative overflow-hidden rounded-xl border shadow-sm"
                  style={{ fontFamily: fontStack, fontSize: `${Math.max(8, opts.baseFontSize - 2)}px`, color: opts.textColor, backgroundColor: opts.pageBackground, lineHeight: opts.lineHeight }}
                >
                  {/* TASLAK filigranı */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <span className="rotate-[-28deg] text-2xl font-bold tracking-widest text-red-500/15">İMZASIZ TASLAK BELGESİ</span>
                  </div>

                  <div className="relative p-4">
                    {/* ÜST: 3 sütun — satıcı / e-Belge / QR+meta */}
                    <div className="flex items-start justify-between gap-3">
                      {/* satıcı */}
                      <div className="min-w-0 flex-1">
                        <div className="font-bold leading-tight" style={{ color: opts.accentColor, fontSize: `${opts.titleScale}em`, textTransform: headingTransform }}>
                          Örnek Firma A.Ş.
                        </div>
                        <div className="mt-0.5 space-y-px text-[9px] opacity-70">
                          <div>Atatürk Cad. No:12 Şişli / İstanbul</div>
                          <div>Vergi Dairesi: Şişli · VKN: 1234567890</div>
                          <div>Tel: 0212 000 00 00 · info@ornek.com</div>
                        </div>
                      </div>
                      {/* e-Belge logosu + kaşe */}
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-red-600 text-[8px] font-bold text-red-600">e-Belge</div>
                        <div className="text-[10px] font-bold" style={{ color: opts.accentColor }}>{docLabel.toUpperCase()}</div>
                        {opts.stampDataUri && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opts.stampDataUri} alt="Kaşe" className="object-contain" style={{ width: Math.min(64, opts.stampWidth), height: Math.min(64, opts.stampHeight) }} />
                        )}
                      </div>
                      {/* QR + logo + meta */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="h-12 w-12 bg-[repeating-conic-gradient(#000_0%_25%,#fff_0%_50%)] bg-[length:5px_5px]" />
                        {opts.logoDataUri && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opts.logoDataUri} alt="Logo" className="object-contain" style={{ width: Math.min(96, opts.logoWidth), height: Math.min(48, opts.logoHeight) }} />
                        )}
                        <table className="border-collapse text-[8px]">
                          <tbody>
                            {[
                              ["Senaryo", "TICARIFATURA"],
                              ["Fatura Tipi", "SATIS"],
                              ["Fatura No", "ABC2026000000123"],
                              ["Tarih", "24-06-2026"],
                            ].map(([k, v]) => (
                              <tr key={k}>
                                <td className="border px-1 font-semibold" style={{ borderColor: opts.tableBorderColor }}>{k}</td>
                                <td className="border px-1" style={{ borderColor: opts.tableBorderColor }}>{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <hr className="my-2" style={{ borderColor: opts.accentColor, borderTopWidth: opts.lineThickness, borderBottomWidth: 0 }} />

                    {/* alıcı */}
                    <div className="text-[9px]">
                      <span className="font-bold" style={{ color: opts.secondaryColor }}>SAYIN</span>
                      <div className="opacity-80">Yılmazlar Tekstil San. ve Tic. Ltd. Şti. · MERKEZ / Amasya · VKN: 6271036106</div>
                    </div>

                    <hr className="my-2" style={{ borderColor: opts.accentColor, borderTopWidth: opts.lineThickness, borderBottomWidth: 0 }} />

                    {/* kalem tablosu */}
                    <table className="w-full border-collapse text-[8.5px]">
                      <thead>
                        <tr style={headerStyle}>
                          {["Sıra", "Mal/Hizmet", "Miktar", "Birim Fiyat", "KDV", "KDV Tutarı", "Tutar"].map((h, i) => (
                            <th key={h} className="border" style={{ padding: cellPad, borderColor: opts.tableBorderColor, textAlign: i === 1 ? "left" : i === 0 ? "center" : "right" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["1", "Danışmanlık Hizmeti", "1", "10.000,00", "%20", "2.000,00", "10.000,00"],
                          ["2", "Yazılım Lisansı", "2", "2.000,00", "%20", "800,00", "4.000,00"],
                          ["3", "Bakım Paketi", "1", "1.250,00", "%20", "250,00", "1.250,00"],
                        ].map((row, i) => (
                          <tr key={row[0]} style={opts.zebraRows && i % 2 === 1 ? { backgroundColor: tint(opts.accentColor, 0.92) } : undefined}>
                            {row.map((c, j) => (
                              <td key={j} className="border" style={{ padding: cellPad, borderColor: opts.tableBorderColor, textAlign: j === 1 ? "left" : j === 0 ? "center" : "right" }}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* toplamlar kutusu */}
                    <div className="mt-2 flex justify-end">
                      <table className="border-collapse text-[9px]">
                        <tbody>
                          {[
                            ["Mal/Hizmet Toplamı", "15.250,00 ₺"],
                            ["Hesaplanan KDV (%20)", "3.050,00 ₺"],
                          ].map(([k, v]) => (
                            <tr key={k}>
                              <td className="border px-1.5 py-0.5 text-right font-semibold" style={{ borderColor: opts.tableBorderColor }}>{k}</td>
                              <td className="border px-1.5 py-0.5 text-right" style={{ borderColor: opts.tableBorderColor }}>{v}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="border px-1.5 py-0.5 text-right font-bold" style={{ borderColor: opts.tableBorderColor, color: opts.accentColor }}>Ödenecek Tutar</td>
                            <td className="border px-1.5 py-0.5 text-right font-bold" style={{ borderColor: opts.tableBorderColor, color: opts.accentColor }}>18.300,00 ₺</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* tutar yazıyla */}
                    <div className="mt-2 border px-2 py-1 text-[9px]" style={{ borderColor: opts.tableBorderColor }}>
                      YALNIZ: # OnSekizBinÜçYüz TRY #
                    </div>

                    {/* alt bilgi */}
                    {opts.footerNote.trim() && (
                      <div className="mt-2 whitespace-pre-line pt-1.5 text-[9px]" style={{ borderTop: `${opts.lineThickness}px solid ${opts.accentColor}` }}>
                        {opts.footerNote}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Bu yalnızca yaklaşık bir şemadır — gerçek düzeni görmek için <b>Gerçek PDF</b> sekmesine geçin.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ALT EYLEM ÇUBUĞU */}
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full space-y-1.5 sm:max-w-xs">
            <Label htmlFor="design-name">Şablon adı</Label>
            <Input id="design-name" value={xsltName} onChange={(e) => setXsltName(e.target.value)} placeholder="ör. Kurumsal Mavi" disabled={busy} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={openPdfNewTab} disabled={busy} title="Gerçek PDF'i yeni sekmede aç">
              <ExternalLink className="mr-2 h-4 w-4" />
              Yeni sekmede
            </Button>
            <Button variant="outline" onClick={preview} disabled={busy}>
              {isPreviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              PDF Önizle
            </Button>
            <Button onClick={save} disabled={busy || !xsltName.trim()}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Tasarımı Kaydet
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Kaydetme sonrası: şablonu bir seri no'ya ata (isteğe bağlı) */}
    <Dialog open={assignOpen} onOpenChange={(o) => !isAssigning && setAssignOpen(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Şablonu bir seri no'ya ata</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">“{savedXsltName}”</span> şablonunu bir {docLabel} seri no'suna
            (prefix) atayabilirsiniz. O seri ile kesilen faturalar bu şablonu kullanır. İsterseniz boş bırakın.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Seri no</Label>
            <select
              value={assignChoice}
              onChange={(e) => setAssignChoice(e.target.value)}
              disabled={isAssigning}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value={ASSIGN_SKIP}>Şimdilik boş bırak</option>
              {assignNumerators.map((n) => (
                <option key={n.prefix} value={n.prefix}>
                  {n.prefix}
                  {activePrefix && n.prefix === activePrefix ? " — kullanımdaki seri no" : ""}
                </option>
              ))}
              <option value={ASSIGN_NEW}>+ Yeni seri no ekle…</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {activePrefix ? (
                <>
                  Şu an {docLabel} gönderiminde{" "}
                  <span className="font-semibold text-foreground">{activePrefix}</span> serisi kullanılıyor.
                </>
              ) : (
                <>Şu an {docLabel} için belirli bir seri seçili değil (Mysoft varsayılanı).</>
              )}
            </p>
          </div>
          {assignChoice === ASSIGN_NEW && (
            <div className="grid gap-1.5">
              <Label htmlFor="assign-new-prefix" className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" /> Yeni prefix (3 karakter)
              </Label>
              <Input
                id="assign-new-prefix"
                value={assignNewPrefix}
                onChange={(e) => setAssignNewPrefix(sanitizePrefix(e.target.value))}
                placeholder="ör. ERA"
                maxLength={3}
                disabled={isAssigning}
                className="font-mono text-base font-semibold uppercase tracking-widest"
              />
              <p className="text-xs text-muted-foreground">
                Bu prefix Mysoft hesabınıza yeni numaratör olarak eklenir ve şablona atanır.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={isAssigning}>
            Boş bırak
          </Button>
          <Button onClick={confirmAssign} disabled={isAssigning || assignChoice === ASSIGN_SKIP}>
            {isAssigning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : assignChoice === ASSIGN_NEW ? (
              <Plus className="mr-2 h-4 w-4" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Ata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

/* ----------------------------- alt bileşenler ----------------------------- */

function ImageUpload({
  title,
  icon,
  dataUri,
  onPick,
  onClear,
  width,
  height,
  onWidth,
  onHeight,
  widthRange,
  heightRange,
  hint,
  disabled,
}: {
  title: string
  icon: React.ReactNode
  dataUri: string
  onPick: () => void
  onClear: () => void
  width: number
  height: number
  onWidth: (v: number) => void
  onHeight: (v: number) => void
  widthRange: [number, number]
  heightRange: [number, number]
  hint: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</h4>
      {dataUri ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-28 items-center justify-center rounded-lg border bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:14px_14px] p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUri} alt={`${title} önizleme`} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" size="sm" onClick={onPick} disabled={disabled}>
                <Upload className="mr-2 h-4 w-4" /> Değiştir
              </Button>
              <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled} className="text-destructive">
                <X className="mr-2 h-4 w-4" /> Kaldır
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RangeField label="Genişlik" value={width} suffix="px" min={widthRange[0]} max={widthRange[1]} step={4} onChange={onWidth} disabled={disabled} />
            <RangeField label="Yükseklik" value={height} suffix="px" min={heightRange[0]} max={heightRange[1]} step={4} onChange={onHeight} disabled={disabled} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-left transition hover:border-kobipo-blue hover:bg-muted/40 disabled:opacity-60 dark:hover:border-primary"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Görsel yükle</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
        </button>
      )}
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  presets,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  presets?: string[]
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
          aria-label={`${label} seç`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-28 font-mono uppercase" maxLength={7} />
        {presets && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                disabled={disabled}
                title={c}
                className={`h-6 w-6 rounded-full border transition hover:scale-110 ${value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-offset-1 ring-kobipo-blue" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RangeField({
  label,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string
  value: number
  suffix?: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label} — <span className="font-mono">{value}{suffix}</span>
      </Label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-kobipo-blue dark:accent-primary"
      />
    </div>
  )
}

function SegmentedControl({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ key: string; label: string }>
  disabled?: boolean
}) {
  return (
    <div className="inline-flex w-full rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => {
        const active = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            disabled={disabled}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
              active ? "bg-kobipo-blue text-white shadow-sm dark:bg-primary dark:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
