"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCanEdit } from "@/components/dashboard/dashboard-company-provider"
import { Loader2, UserPlus } from "lucide-react"

export type CariKind = "customer" | "supplier"

/**
 * Hızlı cari ekleme belge ekranından açılır ama yazdığı şey CARİ KARTIDIR; yetkisi de
 * oradan gelir (`/cari/musteri`, `/cari/tedarikci`). Sunucu kapısı da aynı sahipliği
 * uygular (lib/page-access.ts → `/api/cari/customers` yazma sahibi `/cari/musteri`),
 * yani buradaki kontrol kalkarsa kullanıcı 403 veren bir düğme görür.
 *
 * Cari ekranlarını görmeyen roller (bugün STOCK, ayrıca SALES için tedarikçi) bu
 * yüzden "Yeni cari ekle" seçeneğini HİÇ görmez.
 */
export function useCanCreateCari(): { customer: boolean; supplier: boolean; any: boolean } {
  const customer = useCanEdit("/cari/musteri")
  const supplier = useCanEdit("/cari/tedarikci")
  return { customer, supplier, any: customer || supplier }
}

export type CreatedCari = {
  id: string
  name: string
  nickname?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  district?: string | null
}

type QuickCariDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Ön seçili tip. Satış faturasında "customer", alışta "supplier". */
  defaultKind?: CariKind
  /** Cari isim kutusuna açılışta yazılacak metin (combobox'ta aranan). */
  initialName?: string
  /**
   * VKN/vergi dairesi/adres zorunlu mu? Fatura akışında UBL bu alanları istediği için
   * zorunlu (varsayılan). İrsaliye/sipariş/teklif gibi belgelerde cari elde olmayabilir;
   * oralarda `false` verilir — API zaten yalnız ad ister, eksikler cari kartından tamamlanır.
   */
  requireTaxFields?: boolean
  /** Kayıt başarılıysa oluşan cari + tipiyle çağrılır. */
  onCreated: (created: CreatedCari, kind: CariKind) => void
}

export function QuickCariDialog({
  open,
  onOpenChange,
  companyId,
  defaultKind = "customer",
  initialName = "",
  requireTaxFields = true,
  onCreated,
}: QuickCariDialogProps) {
  const { toast } = useToast()
  const allowed = useCanCreateCari()
  const [kind, setKind] = useState<CariKind>(defaultKind)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    nickname: "",
    taxNumber: "",
    taxOffice: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    district: "",
  })

  // Dialog her açıldığında tipi ve aranan ismi tazele. Ön seçili tipe yetki yoksa
  // izinli olana düşülür — aksi halde kullanıcı kaydedemeyeceği bir formla açılırdı.
  useEffect(() => {
    if (open) {
      setKind(allowed[defaultKind] ? defaultKind : allowed.customer ? "customer" : "supplier")
      setForm({
        name: initialName || "",
        // Takma ad boş açılır: combobox'ta aranan metin ÜNVAN kutusuna gider.
        nickname: "",
        taxNumber: "",
        taxOffice: "",
        phone: "",
        email: "",
        address: "",
        city: "",
        district: "",
      })
    }
  }, [open, defaultKind, initialName, allowed.customer, allowed.supplier])

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async () => {
    const name = form.name.trim()
    if (!name) {
      toast({ title: "Cari adı gerekli", variant: "destructive" })
      return
    }
    const vkn = form.taxNumber.replace(/\D/g, "")
    if (requireTaxFields && !vkn) {
      toast({ title: "VKN/TCKN gerekli", description: "VKN 10, TCKN 11 haneli olmalı", variant: "destructive" })
      return
    }
    // Girildiyse format her koşulda denetlenir — yarım VKN kaydetmek fatura anında patlar.
    if (vkn && !/^\d{10,11}$/.test(vkn)) {
      toast({ title: "VKN/TCKN 10 veya 11 haneli olmalı", variant: "destructive" })
      return
    }
    if (requireTaxFields && !form.taxOffice.trim()) {
      toast({ title: "Vergi dairesi gerekli", variant: "destructive" })
      return
    }
    if (requireTaxFields && !form.address.trim()) {
      toast({ title: "Adres gerekli", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const endpoint = kind === "customer" ? "/api/cari/customers" : "/api/cari/suppliers"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          name,
          nickname: form.nickname.trim() || null,
          taxNumber: vkn || null,
          taxOffice: form.taxOffice.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          district: form.district.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Cari oluşturulamadı")

      const created: CreatedCari = {
        id: data.id,
        name: data.name ?? name,
        nickname: data.nickname ?? (form.nickname.trim() || null),
        taxNumber: data.taxNumber ?? (vkn || null),
        taxOffice: data.taxOffice ?? (form.taxOffice.trim() || null),
        address: data.address ?? (form.address.trim() || null),
        city: data.city ?? (form.city.trim() || null),
        district: data.district ?? (form.district.trim() || null),
      }
      toast({
        title: kind === "customer" ? "Müşteri oluşturuldu" : "Tedarikçi oluşturuldu",
        description: created.name,
      })
      onCreated(created, kind)
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  // Hiçbir cari türünde yazma yetkisi yoksa diyalog HİÇ açılmaz. Çağıranlar da
  // `useCanCreateCari` ile "Yeni cari ekle" seçeneğini gizler; bu ikinci kilit,
  // gizlemeyi unutan bir çağıranın kullanıcıyı 403'e sürüklemesini önler.
  if (!allowed.any) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Yeni Cari Ekle
          </DialogTitle>
          <DialogDescription>
            Belgeye eklemek için hızlıca yeni bir cari oluşturun. Kayıt sonrası otomatik seçilir.
            {!requireTaxFields && " Vergi bilgilerini sonra cari kartından tamamlayabilirsiniz."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Tip seçimi — yalnız YAZMA yetkisi olan türler. Tek tür kaldıysa seçim
              hiç gösterilmez: tek seçenekli bir anahtar kullanıcıya karar sunmaz. */}
          {allowed.customer && allowed.supplier ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("customer")}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  kind === "customer"
                    ? "border-kobipo-blue bg-kobipo-pale/60 text-kobipo-navy dark:bg-primary/15 dark:text-primary"
                    : "border-input hover:bg-accent"
                }`}
                aria-pressed={kind === "customer"}
              >
                Müşteri
              </button>
              <button
                type="button"
                onClick={() => setKind("supplier")}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  kind === "supplier"
                    ? "border-kobipo-blue bg-kobipo-pale/60 text-kobipo-navy dark:bg-primary/15 dark:text-primary"
                    : "border-input hover:bg-accent"
                }`}
                aria-pressed={kind === "supplier"}
              >
                Tedarikçi
              </button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="qc-name">
              Ünvan / Ad Soyad <span className="text-red-500">*</span>
            </Label>
            <Input
              id="qc-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Örn. ABC Ticaret Ltd. Şti."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qc-nickname">Takma Ad</Label>
            <Input
              id="qc-nickname"
              value={form.nickname}
              onChange={(e) => set("nickname", e.target.value)}
              placeholder="Örn. Ali Usta"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              İsteğe bağlı. Cariyi sonraki faturalarda bu adla da arayabilirsiniz; belgelere
              yazılmaz.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-vkn">
                VKN / TCKN {requireTaxFields && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="qc-vkn"
                inputMode="numeric"
                maxLength={11}
                value={form.taxNumber}
                onChange={(e) => set("taxNumber", e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="10 (VKN) veya 11 (TCKN) hane"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-vd">
                Vergi Dairesi {requireTaxFields && <span className="text-red-500">*</span>}
              </Label>
              <Input id="qc-vd" value={form.taxOffice} onChange={(e) => set("taxOffice", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-phone">Telefon</Label>
              <Input id="qc-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-email">E-posta</Label>
              <Input id="qc-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qc-address">
              Adres {requireTaxFields && <span className="text-red-500">*</span>}
            </Label>
            <Input id="qc-address" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-district">İlçe</Label>
              <Input id="qc-district" value={form.district} onChange={(e) => set("district", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-city">İl</Label>
              <Input id="qc-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Vazgeç
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving} variant="success">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Oluştur ve Seç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
