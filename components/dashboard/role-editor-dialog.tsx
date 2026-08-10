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
import { ROLE_TEMPLATES } from "@/lib/nav/role-templates"

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
  onClose,
  onSaved,
}: {
  open: boolean
  /** Düzenlenecek rol; yoksa yeni rol. */
  role?: CompanyRole | null
  /** Yeni rol bir kalıptan başlıyorsa anahtarı. */
  templateKey?: string | null
  companyId: string | null
  onClose: () => void
  onSaved: (role: CompanyRole) => void
}) {
  const { toast } = useToast()
  const selectable = useMemo(() => assignablePages(), [])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [access, setAccess] = useState<Record<string, Access>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const template = templateKey ? ROLE_TEMPLATES.find((t) => t.key === templateKey) : null
    setName(role?.name ?? template?.name ?? "")
    setDescription(role?.description ?? template?.description ?? "")
    setAccess(
      accessFromPaths(
        selectable,
        role?.allowedPaths ?? template?.allowedPaths ?? [],
        role?.writablePaths ?? template?.writablePaths ?? []
      )
    )
  }, [open, role, templateKey, selectable])

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
    setSaving(true)
    try {
      const response = await fetch(
        role?.id ? `/api/company/roles/${role.id}` : "/api/company/roles",
        {
          method: role?.id ? "PATCH" : "POST",
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
      if (!response.ok) throw new Error(data.error || "Rol kaydedilemedi")
      toast({ title: role?.id ? "Rol güncellendi" : `"${name.trim()}" rolü oluşturuldu` })
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
          <DialogTitle>{role?.id ? "Rolü düzenle" : "Yeni rol"}</DialogTitle>
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

        <PagePermissionPicker selectableHrefs={selectable} access={access} onChange={setAccess} />

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
