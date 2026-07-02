"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Save, Upload, Eye, EyeOff, ImagePlus, X, Globe, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/use-toast"
import { Markdown } from "@/components/blog/markdown"
import { slugify } from "@/lib/blog/slug"

interface FormState {
  title: string
  slug: string
  excerpt: string
  category: string
  coverTone: string
  coverImageUrl: string
  readTime: string
  author: string
  status: "DRAFT" | "PUBLISHED"
  body: string
}

const EMPTY: FormState = {
  title: "",
  slug: "",
  excerpt: "",
  category: "",
  coverTone: "blue",
  coverImageUrl: "",
  readTime: "",
  author: "Kobipo Ekibi",
  status: "DRAFT",
  body: "",
}

export function BlogPostEditor({ postId }: { postId?: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const isEdit = Boolean(postId)

  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingBodyImage, setUploadingBodyImage] = useState(false)
  const [slugTouched, setSlugTouched] = useState(isEdit)
  const [showPreview, setShowPreview] = useState(false)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!postId) return
    ;(async () => {
      try {
        const res = await fetch(`/api/blog/${postId}`)
        if (!res.ok) throw new Error("Yazı yüklenemedi")
        const p = await res.json()
        setForm({
          title: p.title ?? "",
          slug: p.slug ?? "",
          excerpt: p.excerpt ?? "",
          category: p.category ?? "",
          coverTone: p.coverTone ?? "blue",
          coverImageUrl: p.coverImageUrl ?? "",
          readTime: p.readTime ?? "",
          author: p.author ?? "Kobipo Ekibi",
          status: p.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
          body: p.body ?? "",
        })
      } catch (e: unknown) {
        toast({
          title: "Hata",
          description: e instanceof Error ? e.message : "Yazı yüklenemedi",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onTitleChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      title: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }))
  }

  const uploadImage = async (file: File): Promise<string | null> => {
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/blog/upload", { method: "POST", body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({
        title: "Görsel yüklenemedi",
        description: data.error || "Bilinmeyen hata",
        variant: "destructive",
      })
      return null
    }
    return data.url as string
  }

  const onCoverSelected = async (file: File | undefined) => {
    if (!file) return
    setUploadingCover(true)
    const url = await uploadImage(file)
    if (url) set("coverImageUrl", url)
    setUploadingCover(false)
  }

  const onBodyImageSelected = async (file: File | undefined) => {
    if (!file) return
    setUploadingBodyImage(true)
    const url = await uploadImage(file)
    if (url) {
      const snippet = `\n![${file.name}](${url})\n`
      const el = bodyRef.current
      const pos = el?.selectionStart ?? form.body.length
      const next = form.body.slice(0, pos) + snippet + form.body.slice(pos)
      set("body", next)
    }
    setUploadingBodyImage(false)
  }

  // statusOverride verilirse yayınla/yayından kaldır; yoksa mevcut durumu koruyarak kaydet.
  const save = async (statusOverride?: FormState["status"]): Promise<boolean> => {
    if (!form.title.trim()) {
      toast({ title: "Başlık gerekli", variant: "destructive" })
      return false
    }
    const status = statusOverride ?? form.status
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        slug: form.slug,
        excerpt: form.excerpt,
        category: form.category || "Genel",
        coverTone: form.coverTone,
        coverImageUrl: form.coverImageUrl || null,
        readTime: form.readTime || null,
        author: form.author,
        status,
        body: form.body,
      }
      const res = await fetch(isEdit ? `/api/blog/${postId}` : "/api/blog", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kaydedilemedi")

      const title =
        statusOverride === "PUBLISHED"
          ? "Yayına alındı"
          : statusOverride === "DRAFT"
            ? "Yayından kaldırıldı"
            : isEdit
              ? "Değişiklikler kaydedildi"
              : "Taslak oluşturuldu"
      toast({ title, description: data.title })

      if (!isEdit) {
        router.push(`/blog-admin/${data.id}`)
      } else {
        setForm((prev) => ({
          ...prev,
          slug: data.slug,
          status: data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
        }))
      }
      return true
    } catch (e: unknown) {
      toast({
        title: "Kaydedilemedi",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isEdit ? "Yazıyı düzenle" : "Yeni yazı"}
            </h1>
            <p className="text-sm text-muted-foreground">Başlık, içerik ve kapak görselini ayarla.</p>
          </div>
          {form.status === "PUBLISHED" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Yayında
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              Taslak
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/blog-admin")}>
            Vazgeç
          </Button>
          <Button variant="success" onClick={() => save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Kaydet
          </Button>
          {form.status === "PUBLISHED" ? (
            <Button variant="outline" onClick={() => save("DRAFT")} disabled={saving}>
              <EyeOff className="mr-2 h-4 w-4" /> Yayından kaldır
            </Button>
          ) : (
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setShowPublishConfirm(true)}
              disabled={saving}
            >
              <Globe className="mr-2 h-4 w-4" /> Yayına Al
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Ana içerik */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label htmlFor="title">Başlık</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Yazı başlığı"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug (URL)</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    set("slug", e.target.value)
                  }}
                  placeholder="url-uyumlu-baslik"
                />
                <p className="text-xs text-muted-foreground">/kurumsal/blog/{form.slug || "..."}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="excerpt">Özet</Label>
                <Textarea
                  id="excerpt"
                  value={form.excerpt}
                  onChange={(e) => set("excerpt", e.target.value)}
                  placeholder="Liste ve kartlarda görünen kısa özet"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="body">İçerik (Markdown)</Label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
                      {uploadingBodyImage ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5" />
                      )}
                      Görsel ekle
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingBodyImage}
                        onChange={(e) => {
                          onBodyImageSelected(e.target.files?.[0])
                          e.target.value = ""
                        }}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPreview((v) => !v)}
                    >
                      {showPreview ? (
                        <>
                          <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Düzenle
                        </>
                      ) : (
                        <>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> Önizle
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {showPreview ? (
                  <div className="min-h-[300px] rounded-md border border-border bg-card p-4">
                    {form.body.trim() ? (
                      <Markdown content={form.body} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Önizlenecek içerik yok.</p>
                    )}
                  </div>
                ) : (
                  <Textarea
                    id="body"
                    ref={bodyRef}
                    value={form.body}
                    onChange={(e) => set("body", e.target.value)}
                    placeholder="# Başlık&#10;&#10;Markdown ile yazın. **kalın**, *italik*, - liste, ![görsel](url)..."
                    rows={18}
                    className="font-mono text-sm"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Yan panel: meta + kapak */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label htmlFor="category">Kategori</Label>
                <Input
                  id="category"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  placeholder="Finans Yönetimi"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="author">Yazar</Label>
                <Input
                  id="author"
                  value={form.author}
                  onChange={(e) => set("author", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="readTime">Okuma süresi</Label>
                <Input
                  id="readTime"
                  value={form.readTime}
                  onChange={(e) => set("readTime", e.target.value)}
                  placeholder="5 dk"
                />
              </div>

              <div className="space-y-2">
                <Label>Kapak tonu (görsel yoksa)</Label>
                <Select value={form.coverTone} onValueChange={(v) => set("coverTone", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Mavi</SelectItem>
                    <SelectItem value="navy">Lacivert</SelectItem>
                    <SelectItem value="green">Yeşil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Kapak görseli</Label>
              {form.coverImageUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.coverImageUrl}
                    alt="Kapak"
                    className="aspect-video w-full rounded-md object-cover"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="absolute right-2 top-2 bg-white/90"
                    onClick={() => set("coverImageUrl", "")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <label className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-sm text-muted-foreground hover:bg-muted">
                  {uploadingCover ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                  Görsel yükle
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingCover}
                    onChange={(e) => {
                      onCoverSelected(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                </label>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="success" onClick={() => save()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Kaydet
        </Button>
      </div>

      <ConfirmDialog
        open={showPublishConfirm}
        onOpenChange={(o) => !saving && setShowPublishConfirm(o)}
        title="Yazıyı yayına al"
        description={
          isEdit
            ? "Bu yazı herkese açık blog sayfasında yayınlanacak. Emin misin?"
            : "Yazı kaydedilip herkese açık blog sayfasında yayınlanacak. Emin misin?"
        }
        confirmLabel="Yayına Al"
        icon={<Globe className="h-5 w-5 text-emerald-600" />}
        isProcessing={saving}
        onConfirm={async () => {
          const ok = await save("PUBLISHED")
          if (ok) setShowPublishConfirm(false)
        }}
      />
    </div>
  )
}
