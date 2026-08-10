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
import { navPage } from "@/lib/nav/pages"
import { ROLE_TEMPLATES } from "@/lib/nav/role-templates"
import { Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react"

/**
 * Firmanın kendi rollerini tanımladığı ekran.
 *
 * Hazır enum roller (Yönetici/Muhasebeci/…) burada GÖRÜNMEZ ve düzenlenemez: onlar
 * ürünün sabit kalıpları. Burada tanımlanan roller firmaya özeldir, adı firma koyar
 * ve sayfa kümesi tamamen serbesttir — hesap yönetimi ekranları hariç.
 */

export default function RollerPage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const companyId = useSearchParams().get("company")
  const [roles, setRoles] = useState<CompanyRole[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<CompanyRole | null>(null)
  const [templateKey, setTemplateKey] = useState<string | null>(null)

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hazır kalıplar</CardTitle>
          <CardDescription>
            Sık kullanılan yetki kümeleri. Seçtiğinizde kopyalanır — sonrasında
            istediğiniz gibi değiştirebilirsiniz, kalıba bağlı kalmaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => openNew(template.key)}
              className="rounded-lg border p-3 text-left transition-colors hover:border-kobipo-blue hover:bg-kobipo-pale/40 dark:hover:bg-primary/10"
            >
              <div className="font-medium">{template.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {template.allowedPaths.length} sayfa · {template.writablePaths.length} düzenleme
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <RoleEditorDialog
        open={open}
        role={editingRole}
        templateKey={templateKey}
        companyId={companyId}
        onClose={() => setOpen(false)}
        onSaved={fetchRoles}
      />
    </div>
  )
}
