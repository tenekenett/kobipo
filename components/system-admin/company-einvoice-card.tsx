"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { FileCheck2, Edit, Save, Loader2, X, CheckCircle2, XCircle, Lock } from "lucide-react"

export interface CompanyEInvoiceData {
  id: string
  isEDonusumEnabled: boolean
  eDonusumIntegrator: "GIB_PORTAL" | "OZEL_ENTEGRATOR"
  eDonusumProvider: string | null
  eDonusumApiUsername: string | null
  hasEDonusumPassword: boolean
  eDonusumApiUrl: string | null
  eDonusumAlias: string | null
  eDonusumTenantVkn: string | null
  eFaturaPrefix: string | null
  eArchivePrefix: string | null
  invoiceSeriesPrefix: string | null
  // Otomatik keşfedilen entegratör yönlendirme alanları (salt-okunur)
  eDonusumConnectorGuid: string | null
  eDonusumPkAlias: string | null
  eDonusumGbAlias: string | null
  eDonusumLastTestedAt: string | null
  eDonusumLastTestSuccess: boolean | null
  // DB'den hesaplanan son kesilen belge numaraları (seri bazında, salt-okunur)
  lastEFaturaInvoiceNo: string | null
  lastEArchiveInvoiceNo: string | null
  lastSeriInvoiceNo: string | null
}

const integratorLabels: Record<CompanyEInvoiceData["eDonusumIntegrator"], string> = {
  GIB_PORTAL: "GİB Portal",
  OZEL_ENTEGRATOR: "Özel Entegratör",
}

// Belge no formatı: PREFIX + YIL + 9 haneli sıra. Sıra entegratör tarafında otomatik artar.
function exampleDocNo(prefix: string | null) {
  if (!prefix) return null
  return `${prefix}${new Date().getFullYear()}000001`
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-200 break-words mt-0.5">{value || "-"}</p>
    </div>
  )
}

function NumeratorBox({
  label,
  prefix,
  example,
  lastNo,
}: {
  label: string
  prefix: string | null
  example: string | null
  lastNo: string | null
}) {
  return (
    <div className="rounded-md bg-slate-900/60 border border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        {prefix ? (
          <span className="inline-flex h-6 items-center rounded bg-slate-700/60 px-1.5 font-mono text-xs font-bold tracking-widest text-slate-200">
            {prefix}
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">otomatik</span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Örnek belge no</p>
          <p className="font-mono text-sm text-slate-300">{example ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Son kesilen</p>
          <p className="font-mono text-sm text-emerald-300">{lastNo ?? "Henüz yok"}</p>
        </div>
      </div>
    </div>
  )
}

export function CompanyEInvoiceCard({ data }: { data: CompanyEInvoiceData }) {
  const router = useRouter()
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    isEDonusumEnabled: data.isEDonusumEnabled,
    eDonusumIntegrator: data.eDonusumIntegrator,
    eDonusumProvider: data.eDonusumProvider ?? "",
    eDonusumApiUsername: data.eDonusumApiUsername ?? "",
    eDonusumApiPassword: "",
    eDonusumApiUrl: data.eDonusumApiUrl ?? "",
    eDonusumAlias: data.eDonusumAlias ?? "",
    eDonusumTenantVkn: data.eDonusumTenantVkn ?? "",
    eFaturaPrefix: data.eFaturaPrefix ?? "",
    eArchivePrefix: data.eArchivePrefix ?? "",
    invoiceSeriesPrefix: data.invoiceSeriesPrefix ?? "",
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const cancel = () => {
    setForm({
      isEDonusumEnabled: data.isEDonusumEnabled,
      eDonusumIntegrator: data.eDonusumIntegrator,
      eDonusumProvider: data.eDonusumProvider ?? "",
      eDonusumApiUsername: data.eDonusumApiUsername ?? "",
      eDonusumApiPassword: "",
      eDonusumApiUrl: data.eDonusumApiUrl ?? "",
      eDonusumAlias: data.eDonusumAlias ?? "",
      eDonusumTenantVkn: data.eDonusumTenantVkn ?? "",
      eFaturaPrefix: data.eFaturaPrefix ?? "",
      eArchivePrefix: data.eArchivePrefix ?? "",
      invoiceSeriesPrefix: data.invoiceSeriesPrefix ?? "",
    })
    setIsEditing(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Yalnızca e-fatura alanları gönderilir; API kısmi güncellemeyi destekler, diğer
      // firma alanları (ad, vergi no vb.) etkilenmez.
      // Şifre alanı yalnızca yeni bir değer girildiyse gönderilir (boşsa mevcut korunur).
      const payload: Record<string, unknown> = {
        isEDonusumEnabled: form.isEDonusumEnabled,
        eDonusumIntegrator: form.eDonusumIntegrator,
        eDonusumProvider: form.eDonusumProvider,
        eDonusumApiUsername: form.eDonusumApiUsername,
        eDonusumApiUrl: form.eDonusumApiUrl,
        eDonusumAlias: form.eDonusumAlias,
        eDonusumTenantVkn: form.eDonusumTenantVkn,
        eFaturaPrefix: form.eFaturaPrefix,
        eArchivePrefix: form.eArchivePrefix,
        invoiceSeriesPrefix: form.invoiceSeriesPrefix,
      }
      if (form.eDonusumApiPassword.trim()) {
        payload.eDonusumApiPassword = form.eDonusumApiPassword.trim()
      }

      const res = await fetch(`/api/system-admin/companies/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Kaydetme başarısız")
      toast({ title: "Başarılı", description: "E-Dönüşüm bilgileri güncellendi" })
      setIsEditing(false)
      router.refresh()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800 lg:col-span-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-cyan-400" />
              E-Dönüşüm / E-Fatura Yapılandırması
            </CardTitle>
            <CardDescription className="text-slate-500">
              Entegratör kimlik bilgileri, numaratör prefix&apos;leri ve bağlantı durumu
            </CardDescription>
          </div>
          {!isEditing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0"
            >
              <Edit className="h-4 w-4 mr-2" />
              Düzenle
            </Button>
          ) : (
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={cancel}
                disabled={saving}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <X className="h-4 w-4 mr-1" />
                Vazgeç
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Kaydet
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          <div className="space-y-4">
            {/* Durum rozetleri */}
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  data.isEDonusumEnabled
                    ? "bg-green-500/20 text-green-400"
                    : "bg-slate-700/50 text-slate-400"
                }`}
              >
                {data.isEDonusumEnabled ? "E-Dönüşüm Aktif" : "E-Dönüşüm Pasif"}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-700/50 text-slate-300">
                {integratorLabels[data.eDonusumIntegrator]}
              </span>
              {data.eDonusumLastTestSuccess !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                    data.eDonusumLastTestSuccess
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {data.eDonusumLastTestSuccess ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Son test {data.eDonusumLastTestSuccess ? "başarılı" : "başarısız"}
                  {data.eDonusumLastTestedAt &&
                    ` · ${new Date(data.eDonusumLastTestedAt).toLocaleString("tr-TR")}`}
                </span>
              )}
            </div>

            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Entegratör / Sağlayıcı" value={data.eDonusumProvider} />
              <Field label="API Kullanıcı Adı" value={data.eDonusumApiUsername} />
              <Field
                label="API Şifre"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3.5 w-3.5 text-slate-500" />
                    {data.hasEDonusumPassword ? "•••••••• (kayıtlı)" : "Tanımlı değil"}
                  </span>
                }
              />
              <Field label="API URL" value={data.eDonusumApiUrl} />
              <Field label="Alias / Etiket" value={data.eDonusumAlias} />
              <Field label="Tenant VKN" value={data.eDonusumTenantVkn} />
              <Field
                label="E-Fatura Prefix"
                value={
                  data.eFaturaPrefix ? (
                    <span className="font-mono tracking-widest">{data.eFaturaPrefix}</span>
                  ) : (
                    <span className="text-slate-500">Otomatik (varsayılan)</span>
                  )
                }
              />
              <Field
                label="E-Arşiv Prefix"
                value={
                  data.eArchivePrefix ? (
                    <span className="font-mono tracking-widest">{data.eArchivePrefix}</span>
                  ) : (
                    <span className="text-slate-500">Otomatik (varsayılan)</span>
                  )
                }
              />
              <Field
                label="Kobipo Fatura Seri Prefix"
                value={
                  data.invoiceSeriesPrefix ? (
                    <span className="font-mono tracking-widest">{data.invoiceSeriesPrefix}</span>
                  ) : null
                }
              />
            </div>

            {/* Belge numaratörleri: örnek belge no + son kesilen numara (DB) */}
            <div className="rounded-lg bg-slate-800/40 p-3">
              <p className="text-xs font-medium text-slate-400 mb-3">Belge Numaratörleri</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumeratorBox
                  label="E-Fatura"
                  prefix={data.eFaturaPrefix}
                  example={exampleDocNo(data.eFaturaPrefix)}
                  lastNo={data.lastEFaturaInvoiceNo}
                />
                <NumeratorBox
                  label="E-Arşiv"
                  prefix={data.eArchivePrefix}
                  example={exampleDocNo(data.eArchivePrefix)}
                  lastNo={data.lastEArchiveInvoiceNo}
                />
                <NumeratorBox
                  label="Kobipo Seri"
                  prefix={data.invoiceSeriesPrefix}
                  example={exampleDocNo(data.invoiceSeriesPrefix)}
                  lastNo={data.lastSeriInvoiceNo}
                />
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Belge no formatı: <span className="font-mono">PREFIX + YIL + sıra</span>. Sıra
                entegratör tarafında otomatik artar.
              </p>
            </div>

            {/* Otomatik keşfedilen yönlendirme alanları */}
            {(data.eDonusumConnectorGuid || data.eDonusumPkAlias || data.eDonusumGbAlias) && (
              <div className="rounded-lg bg-slate-800/40 p-3">
                <p className="text-xs font-medium text-slate-400 mb-2">
                  Otomatik Keşfedilen Yönlendirme Bilgileri
                </p>
                <div className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
                  <Field label="Connector GUID" value={data.eDonusumConnectorGuid} />
                  <Field label="PK Alias" value={data.eDonusumPkAlias} />
                  <Field label="GB Alias" value={data.eDonusumGbAlias} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-lg bg-slate-800/40 p-3">
              <div>
                <Label className="text-slate-300">E-Dönüşüm Aktif</Label>
                <p className="text-xs text-slate-500">Firma için e-fatura/e-arşiv entegrasyonu</p>
              </div>
              <Switch
                checked={form.isEDonusumEnabled}
                onCheckedChange={(v) => set("isEDonusumEnabled", v)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Entegratör</Label>
                <Select
                  value={form.eDonusumIntegrator}
                  onValueChange={(v) =>
                    set("eDonusumIntegrator", v as CompanyEInvoiceData["eDonusumIntegrator"])
                  }
                >
                  <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GIB_PORTAL">GİB Portal</SelectItem>
                    <SelectItem value="OZEL_ENTEGRATOR">Özel Entegratör</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Entegratör / Sağlayıcı Adı</Label>
                <Input
                  value={form.eDonusumProvider}
                  onChange={(e) => set("eDonusumProvider", e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Tenant VKN</Label>
                <Input
                  value={form.eDonusumTenantVkn}
                  onChange={(e) =>
                    set("eDonusumTenantVkn", e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  placeholder="11 haneli VKN/TCKN"
                  className="bg-slate-800/50 border-slate-700 text-white font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">API Kullanıcı Adı</Label>
                <Input
                  value={form.eDonusumApiUsername}
                  onChange={(e) => set("eDonusumApiUsername", e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">API Şifre</Label>
                <Input
                  type="password"
                  value={form.eDonusumApiPassword}
                  onChange={(e) => set("eDonusumApiPassword", e.target.value)}
                  placeholder={data.hasEDonusumPassword ? "•••••• (değiştirmek için yaz)" : "Tanımlı değil"}
                  className="bg-slate-800/50 border-slate-700 text-white"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">API URL</Label>
                <Input
                  value={form.eDonusumApiUrl}
                  onChange={(e) => set("eDonusumApiUrl", e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Alias / Etiket</Label>
                <Input
                  value={form.eDonusumAlias}
                  onChange={(e) => set("eDonusumAlias", e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">E-Fatura Prefix</Label>
                <Input
                  value={form.eFaturaPrefix}
                  onChange={(e) =>
                    set("eFaturaPrefix", e.target.value.toUpperCase().slice(0, 3))
                  }
                  placeholder="Boş = otomatik"
                  className="bg-slate-800/50 border-slate-700 text-white font-mono tracking-widest"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">E-Arşiv Prefix</Label>
                <Input
                  value={form.eArchivePrefix}
                  onChange={(e) =>
                    set("eArchivePrefix", e.target.value.toUpperCase().slice(0, 3))
                  }
                  placeholder="Boş = otomatik"
                  className="bg-slate-800/50 border-slate-700 text-white font-mono tracking-widest"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Kobipo Fatura Seri Prefix</Label>
                <Input
                  value={form.invoiceSeriesPrefix}
                  onChange={(e) => set("invoiceSeriesPrefix", e.target.value.toUpperCase())}
                  placeholder="ör. SAT"
                  className="bg-slate-800/50 border-slate-700 text-white font-mono"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Connector GUID / PK / GB Alias alanları entegratörden otomatik keşfedilir, buradan
              düzenlenmez.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
