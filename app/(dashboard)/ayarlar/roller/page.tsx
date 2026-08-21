"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { RoleEditorDialog, type CompanyRole } from "@/components/dashboard/role-editor-dialog"
import { filterAvailablePages, missingModuleLabels, navPage } from "@/lib/nav/pages"
import { usePageAvailability } from "@/components/dashboard/write-guard"
import { useRoleTemplates } from "@/lib/swr/use-role-templates"
import { Check, Lock, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react"

/**
 * Firmanın kendi rollerini tanımladığı ekran.
 *
 * Hazır enum roller (Yönetici/Muhasebeci/…) burada GÖRÜNMEZ ve düzenlenemez: onlar
 * ürünün sabit kalıpları. Burada tanımlanan roller firmaya özeldir, adı firma koyar
 * ve sayfa kümesi tamamen serbesttir — hesap yönetimi ekranları hariç.
 */

/**
 * Modül adlarını Türkçe bir listeye çevirir: "A", "A ve B", "A, B ve C".
 * Hepsini " ve " ile bağlamak üç öğeden sonra okunmaz hâle geliyordu.
 */
function listTr(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} ve ${labels[labels.length - 1]}`
}

export default function RollerPage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const companyId = useSearchParams().get("company")
  const [roles, setRoles] = useState<CompanyRole[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<CompanyRole | null>(null)
  const [templateKey, setTemplateKey] = useState<string | null>(null)
  const availability = usePageAvailability()
  // Kalıplar artık koddan değil katalogdan gelir (sistem yönetim panelinden düzenlenir).
  const { templates } = useRoleTemplates()

  const fetchRoles = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/company/roles?companyId=${encodeURIComponent(companyId)}`)
      if (response.ok) setRoles(await response.json())
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetchRoles()
  }, [fetchRoles])

  /**
   * Hangi kalıptan zaten rol üretilmiş? Kart bunu göstermezse kullanıcı "rolüm burada"
   * diye karta basıyor, diyalog YENİ rol modunda açılıyor ve Kaydet 409 döndürüyordu —
   * kullanıcının gördüğü "bu rol zaten kayıtlı" hatasının birinci kaynağı buydu.
   */
  const roleByTemplate = useMemo(() => {
    const map = new Map<string, CompanyRole>()
    for (const role of roles) if (role.templateKey) map.set(role.templateKey, role)
    return map
  }, [roles])

  const openNew = (template?: string) => {
    setEditingRole(null)
    setTemplateKey(template ?? null)
    setOpen(true)
  }

  const openEdit = (role: CompanyRole) => {
    setEditingRole(role)
    setTemplateKey(null)
    setOpen(true)
  }

  const remove = async (role: CompanyRole) => {
    const ok = await confirm({
      title: `"${role.name}" rolü silinsin mi?`,
      description: "Bu işlem geri alınamaz.",
    })
    if (!ok) return
    const response = await fetch(
      `/api/company/roles/${role.id}?companyId=${encodeURIComponent(companyId ?? "")}`,
      { method: "DELETE" }
    )
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      toast({ title: "Silinemedi", description: data.error, variant: "destructive" })
      return
    }
    toast({ title: "Rol silindi" })
    fetchRoles()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-kobipo-blue" />
                Rol Yetkileri
              </CardTitle>
              <CardDescription>
                İşletmenize özel roller tanımlayın: adını siz koyun, hangi sayfaları
                görüp değiştirebileceğini tek tek seçin. Hazır roller (Yönetici,
                Muhasebeci…) değişmez; buradakiler onların yerine geçer.
              </CardDescription>
            </div>
            <Button onClick={() => openNew()}>
              <Plus className="mr-1 h-4 w-4" /> Sıfırdan rol
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
          {!loading && roles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Henüz özel rol yok. Aşağıdaki hazır kalıplardan biriyle başlayabilir ya da
              sıfırdan tanımlayabilirsiniz.
            </p>
          )}
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{role.name}</div>
                {role.description && (
                  <div className="text-xs text-muted-foreground">{role.description}</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{role.allowedPaths.length} sayfa</span>
                  <span>{role.writablePaths.length} tanesinde düzenleme</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {role._count?.members ?? 0} çalışan
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {role.allowedPaths
                    .slice(0, 6)
                    .map((href) => navPage(href)?.label ?? href)
                    .join(", ")}
                  {role.allowedPaths.length > 6 ? ` +${role.allowedPaths.length - 6}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(role)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Düzenle
                </Button>
                <Button variant="outline" size="sm" onClick={() => remove(role)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Katalog boşsa (tüm kalıplar pasifleştirilmiş) bölümü hiç basmıyoruz: boş bir
          ızgara "kalıp yüklenemedi" gibi okunuyor. */}
      {templates.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hazır kalıplar</CardTitle>
          <CardDescription>
            Sık kullanılan yetki kümeleri. Seçtiğinizde kopyalanır — sonrasında
            istediğiniz gibi değiştirebilirsiniz, kalıba bağlı kalmaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const created = roleByTemplate.get(template.key)
            // Kalıbın sayfaları firmanın AÇIK modüllerine göre süzülür. Kart eskiden
            // kalıbın statik sayısını basıyordu; diyalog ise seçiciyi süzdüğü için
            // "4 sayfa" yazan kart "0/8 seçili" bir form açıyordu.
            const usable = filterAvailablePages(template.allowedPaths, availability)
            const usableWritable = filterAvailablePages(template.writablePaths, availability)
            const missing = missingModuleLabels(template.allowedPaths, availability)
            // Rol zaten üretilmişse kart düzenlemeye götürür — modül sonradan kapansa
            // bile o role erişimi kesmek yanlış olur.
            const locked = !created && usable.length === 0
            return (
              <button
                key={template.key}
                type="button"
                disabled={locked}
                title={locked ? `${listTr(missing)} modülü gerekli` : undefined}
                onClick={() => (created ? openEdit(created) : openNew(template.key))}
                className={
                  locked
                    ? "cursor-not-allowed rounded-lg border border-dashed p-3 text-left opacity-60"
                    : "rounded-lg border p-3 text-left transition-colors hover:border-kobipo-blue hover:bg-kobipo-pale/40 dark:hover:bg-primary/10"
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{template.name}</div>
                  {created ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-kobipo-pale px-2 py-0.5 text-[10px] font-medium text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                      <Check className="h-3 w-3" /> Oluşturuldu
                    </span>
                  ) : (
                    locked && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Lock className="h-3 w-3" /> Modül kapalı
                      </span>
                    )
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {created ? (
                    <span className="inline-flex items-center gap-1 text-kobipo-blue dark:text-primary">
                      <Pencil className="h-3 w-3" /> “{created.name}” rolünü düzenle
                    </span>
                  ) : locked ? (
                    `Bu kalıp ${listTr(missing)} ${missing.length > 1 ? "modüllerini" : "modülünü"} gerektiriyor.`
                  ) : (
                    <>
                      {usable.length} sayfa · {usableWritable.length} düzenleme
                      {/* Kısmen kapalı kalıp: sayı zaten düşük basılıyor, eksik modülü
                          söylemezsek kullanıcı "neden 10 değil 7" diye takılır. */}
                      {missing.length > 0 && (
                        <span className="block text-amber-700 dark:text-amber-500">
                          {listTr(missing)} kapalı olduğu için bazı sayfalar çıkarıldı.
                        </span>
                      )}
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>
      )}

      <RoleEditorDialog
        open={open}
        role={editingRole}
        templateKey={templateKey}
        companyId={companyId}
        existingRoles={roles}
        onClose={() => {
          // State'i sıfırlamazsak diyalog bir sonraki açılışında önceki rolü/kalıbı
          // taşır ve "yeni rol" derken eskisini düzenlemiş oluruz (ya da tersi).
          setOpen(false)
          setEditingRole(null)
          setTemplateKey(null)
        }}
        onSaved={fetchRoles}
      />
    </div>
  )
}
