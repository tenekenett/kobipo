"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  PagePermissionPicker,
  accessFromPaths,
  pathsFromAccess,
  type Access,
} from "@/components/dashboard/page-permission-picker"
import { ACCOUNT_ADMIN_PAGES, assignablePages, navPage } from "@/lib/nav/pages"
import { useRoleTemplates } from "@/lib/swr/use-role-templates"
import { findRoleNameConflict, roleWriteTarget } from "@/lib/nav/role-conflict"
import { usePageAvailability } from "@/components/dashboard/write-guard"
import { AlertTriangle } from "lucide-react"

/**
 * Özel rol oluşturma/düzenleme formu. Hem Rol Yetkileri ekranı hem Ekip Yönetimi
 * kullanır — çalışan eklerken ihtiyaç duyulan rolü tanımlamak için sayfa değiştirmek
 * gerekmesin diye.
 */

export type CompanyRole = {
  id: string
  name: string
  description?: string | null
  allowedPaths: string[]
  writablePaths: string[]
  templateKey?: string | null
  _count?: { members: number }
}

export function RoleEditorDialog({
  open,
  role,
  templateKey,
  companyId,
  existingRoles,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Düzenlenecek rol; yoksa yeni rol. */
  role?: CompanyRole | null
  /** Yeni rol bir kalıptan başlıyorsa anahtarı. */
  templateKey?: string | null
  companyId: string | null
  /**
   * Firmanın mevcut rolleri. Ad çakışmasını KAYDET'ten önce görebilmek ve "aslında bunu
   * düzenlemek istiyordum" durumunda 409'a çarpmadan düzenlemeye geçebilmek için.
   */
  existingRoles?: CompanyRole[]
  onClose: () => void
  onSaved: (role: CompanyRole) => void
}) {
  const { toast } = useToast()
  const availability = usePageAvailability()
  // SWR önbelleği Rol Yetkileri ekranıyla paylaşılır; diyalog ayrı istek atmaz.
  const { templates } = useRoleTemplates()
  /**
   * Seçilebilir sayfalar: firmanın AÇIK modüllerininkiler + rolün HÂLİHAZIRDA sahip
   * olduğu sayfalar.
   *
   * Birleşim şart. Yalnız açık modülleri gösterseydik, modülü geçici kapalı bir firmada
   * yöneticinin rolü açıp kaydetmesi o modülün sayfalarını rolden sessizce SİLERDİ —
   * `pathsFromAccess` yalnız listedekileri döndürüyor. Kapalı modülün sayfası artık
   * teklif EDİLMİYOR ama zaten verilmişse korunuyor.
   */
  const selectable = useMemo(() => {
    const available = assignablePages(availability)
    const owned = role?.allowedPaths ?? []
    return available.concat(owned.filter((href) => !available.includes(href)))
  }, [availability, role])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [access, setAccess] = useState<Record<string, Access>>({})
  const [saving, setSaving] = useState(false)
  /**
   * Hangi rolü yazıyoruz? Başlangıçta `role?.id` (yoksa null = yeni rol), ama kullanıcı
   * çakışan bir ada kaydetmeyi seçerse diyalog açıkken düzenlemeye DÖNEBİLİR. `role`
   * prop'u yerine bunu kullanıyoruz ki POST/PATCH kararı o anki gerçeği yansıtsın.
   */
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const template = templateKey ? templates.find((t) => t.key === templateKey) : null
    setEditingId(role?.id ?? null)
    setName(role?.name ?? template?.name ?? "")
    setDescription(role?.description ?? template?.description ?? "")
    setAccess(
      accessFromPaths(
        selectable,
        role?.allowedPaths ?? template?.allowedPaths ?? [],
        role?.writablePaths ?? template?.writablePaths ?? []
      )
    )
  }, [open, role, templateKey, templates, selectable])

  /** Yazılan ad, düzenlenenin dışındaki bir rolle çakışıyor mu? */
  const conflict = useMemo(
    () => findRoleNameConflict(existingRoles, name, editingId),
    [existingRoles, name, editingId]
  )

  /** Çakışan rolü forma yükleyip düzenleme moduna geçer (kayıtlı yetkileri getirir). */
  const loadConflictingRole = (target: CompanyRole) => {
    setEditingId(target.id)
    setName(target.name)
    setDescription(target.description ?? "")
    setAccess(accessFromPaths(selectable, target.allowedPaths, target.writablePaths))
  }

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Rol adı zorunlu", variant: "destructive" })
      return
    }
    const { allowedPaths, writablePaths } = pathsFromAccess(access)
    if (allowedPaths.length === 0) {
      toast({ title: "En az bir sayfa seçin", variant: "destructive" })
      return
    }
    // Ad çakışıyorsa yeni rol AÇMAYIZ, çakışanı güncelleriz: kullanıcı bu noktada zaten
    // "mevcut rolü güncelle" yazan düğmeye basmıştır (bkz. aşağıdaki uyarı kutusu).
    const targetId = roleWriteTarget(editingId, conflict)
    setSaving(true)
    try {
      const response = await fetch(
        targetId ? `/api/company/roles/${targetId}` : "/api/company/roles",
        {
          method: targetId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            name: name.trim(),
            description: description.trim(),
            templateKey: templateKey ?? undefined,
            allowedPaths,
            writablePaths,
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        // Liste bayatsa (başka sekmede rol açılmış olabilir) çakışmayı ancak burada
        // öğreniriz. Çıkmaz sokakta bırakmayıp düzenlemeye geçiyoruz; yazma işini
        // kullanıcının ikinci onayına bırakmak için kaydı kendiliğinden tekrarlamıyoruz.
        if (response.status === 409 && typeof data.existingRoleId === "string") {
          setEditingId(data.existingRoleId)
          toast({
            title: "Bu isimde bir rol zaten var",
            description: "Düzenleme moduna geçildi — ekrandaki yetkileri o role yazmak için tekrar Kaydet'e basın.",
            variant: "destructive",
          })
          return
        }
        throw new Error(data.error || "Rol kaydedilemedi")
      }
      toast({ title: targetId ? "Rol güncellendi" : `"${name.trim()}" rolü oluşturuldu` })
      onSaved(data as CompanyRole)
      onClose()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Rol kaydedilemedi",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const adminLabels = ACCOUNT_ADMIN_PAGES.map((h) => navPage(h)?.label).filter(Boolean).join(", ")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? "Rolü düzenle" : "Yeni rol"}</DialogTitle>
          <DialogDescription>
            Adını siz koyun, yetkileri tek tek seçin. Hesap yönetimi ekranları
            ({adminLabels}) listede yoktur: bunlar yetki dağıtan ekranlardır ve yalnız
            firma yöneticisinde kalır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="role-name">Rol adı</Label>
            <Input
              id="role-name"
              value={name}
              placeholder="ör. Garson"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="role-desc">Açıklama (isteğe bağlı)</Label>
            <Input
              id="role-desc"
              value={description}
              placeholder="Bu rol ne yapar?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {conflict && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="min-w-0 flex-1">
              <strong>“{conflict.name}”</strong> adında bir rol zaten var. Kaydet dediğinizde
              yeni rol açılmaz, ekrandaki yetkiler o role yazılır.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadConflictingRole(conflict)}
              disabled={saving}
            >
              Mevcut yetkilerini getir
            </Button>
          </div>
        )}

        <PagePermissionPicker selectableHrefs={selectable} access={access} onChange={setAccess} />

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving
              ? "Kaydediliyor…"
              : conflict
                ? `“${conflict.name}” rolünü güncelle`
                : editingId
                  ? "Değişiklikleri kaydet"
                  : "Kaydet"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
