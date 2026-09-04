"use client"

// Satın alma ekranlarında ödeme ÖNCESİ doldurulan fatura bilgisi formu.
// Kontör ve paket/abonelik akışlarının ikisi de bunu kullanır.
//
// Doğrulamanın TEK yetkili yeri sunucudur ([[lib/invoicing/billing-info.ts]]); buradaki
// kontrol yalnız kullanıcıyı ödeme sayfasına gitmeden uyarmak içindir. Sunucu 412
// dönerse `invalidFields` ile eksik alanlar işaretlenir.

import { useCallback, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CityDistrictSelect } from "@/components/address/city-district-select"
import { Loader2 } from "lucide-react"

export type BillingFormValue = {
  name: string
  taxNumber: string
  taxOffice: string
  address: string
  city: string
  district: string
  email: string
}

export const EMPTY_BILLING: BillingFormValue = {
  name: "",
  taxNumber: "",
  taxOffice: "",
  address: "",
  city: "",
  district: "",
  email: "",
}

/** Sunucudaki kuralların istemci aynası — hangi alan eksik/geçersiz? */
export function missingBillingFields(v: BillingFormValue): string[] {
  const missing: string[] = []
  const digits = v.taxNumber.replace(/\D/g, "")
  if (v.name.trim().length < 3) missing.push("name")
  if (!/^\d{10,11}$/.test(digits) || /^(\d)\1+$/.test(digits)) missing.push("taxNumber")
  // Vergi dairesi yalnız 10 haneli VKN (mükellef) için zorunlu.
  if (digits.length === 10 && v.taxOffice.trim().length < 2) missing.push("taxOffice")
  if (v.address.trim().length < 5) missing.push("address")
  if (v.city.trim().length < 2) missing.push("city")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) missing.push("email")
  return missing
}

/**
 * Fatura bilgilerini yükler. Alıcı DAİMA verilen firmadır: abonelik firma bazında
 * olduğu için fatura da satın alan firmaya kesilir (şubede bu ana firmayla aynı tüzel
 * kişidir, ek firmada kendi VKN'sidir). Eskiden burada bir `scope="account"` seçeneği
 * vardı ve hesap kökünü çözüyordu — kaldırıldı; bkz. FIRMA-BAZLI-ABONELIK.md.
 */
export function useBillingInfo(companyId: string) {
  const [value, setValue] = useState<BillingFormValue>(EMPTY_BILLING)
  const [loading, setLoading] = useState(true)
  const [complete, setComplete] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/invoicing/billing-info?companyId=${encodeURIComponent(companyId)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.billing) {
        setValue({ ...EMPTY_BILLING, ...data.billing })
        setComplete(Boolean(data.complete))
      }
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  return { value, setValue, loading, complete, reload: load }
}

type Props = {
  value: BillingFormValue
  onChange: (v: BillingFormValue) => void
  /** Sunucunun 412 ile bildirdiği alanlar — kırmızıya boyanır. */
  invalidFields?: string[]
  loading?: boolean
}

export function BillingInfoForm({ value, onChange, invalidFields = [], loading }: Props) {
  const set = (patch: Partial<BillingFormValue>) => onChange({ ...value, ...patch })
  const bad = (field: string) => invalidFields.includes(field)
  const cls = (field: string) => (bad(field) ? "border-destructive focus-visible:ring-destructive" : "")

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Fatura bilgileri yükleniyor…
      </div>
    )
  }

  const isTckn = value.taxNumber.replace(/\D/g, "").length === 11

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="billing-name">Ünvan / Ad Soyad *</Label>
        <Input
          id="billing-name"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className={cls("name")}
          placeholder="Faturada görünecek resmî ünvan"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="billing-tax-number">VKN / TCKN *</Label>
          <Input
            id="billing-tax-number"
            value={value.taxNumber}
            inputMode="numeric"
            maxLength={11}
            onChange={(e) => set({ taxNumber: e.target.value.replace(/\D/g, "") })}
            className={cls("taxNumber")}
            placeholder="10 hane VKN veya 11 hane TCKN"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billing-tax-office">Vergi Dairesi {isTckn ? "" : "*"}</Label>
          <Input
            id="billing-tax-office"
            value={value.taxOffice}
            onChange={(e) => set({ taxOffice: e.target.value })}
            className={cls("taxOffice")}
            placeholder={isTckn ? "TCKN'de gerekmez" : "Örn. Pamukkale"}
            disabled={isTckn}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="billing-address">Adres *</Label>
        <Input
          id="billing-address"
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          className={cls("address")}
          placeholder="Mahalle, sokak, no"
        />
      </div>

      {/* İl/ilçe sabit listeden seçilir; faturaya GİB'in tanıdığı yazımla gider. */}
      <CityDistrictSelect
        idPrefix="billing"
        city={value.city}
        district={value.district}
        onChange={({ city, district }) => set({ city, district })}
        cityLabel="İl *"
        cityClassName={cls("city")}
        containerClassName="grid gap-3 sm:grid-cols-2"
      />

      <div className="space-y-1.5">
        <Label htmlFor="billing-email">Fatura e-postası *</Label>
        <Input
          id="billing-email"
          type="email"
          value={value.email}
          onChange={(e) => set({ email: e.target.value })}
          className={cls("email")}
          placeholder="fatura@firmaniz.com"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Fatura bu bilgilerle düzenlenir. Alıcı e-Fatura mükellefiyse belge e-Fatura,
        değilse e-Arşiv olarak kesilir.
      </p>
    </div>
  )
}
