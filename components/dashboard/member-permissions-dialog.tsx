"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { NAV_PAGES, pagesForRole } from "@/lib/nav/pages"
import { roleLabel } from "@/lib/auth/role-labels"
import { CompanyLink } from "@/components/dashboard/company-link"
import {
  PagePermissionPicker,
  accessFromPaths,
  pathsFromAccess,
  type Access,
} from "@/components/dashboard/page-permission-picker"
import { ShieldCheck } from "lucide-react"

/**
 * Bir ekip üyesinin KİŞİSEL sayfa kısıtı.
 *
 * İki farklı dünya var ve bu dialog ikisini karıştırmamalı:
 *  - Hazır enum rol (Satış, Muhasebeci…): tavan o rolün matrisidir, burada yalnız
 *    DARALTMA yapılır.
 *  - Özel rol (firma tanımlı): yetki rolün kendisinde durur, kişiye özel liste
 *    tutulmaz. Aksi halde "aynı rol iki kişide farklı davranıyor" olurdu. Bu durumda
 *    dialog düzenleme değil, rolün ekranına yönlendirme gösterir.
 */

type Member = {
  id: string
  role: string
  allowedPaths?: string[]
  writablePaths?: string[]
  customRoleId?: string | null
  customRole?: { id: string; name: string } | null
  user?: { name?: string | null; email: string }
}

export function MemberPermissionsDialog({
  member,
  companyId,
  onClose,
  onSaved,
}: {
  member: Member | null
  companyId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [access, setAccess] = useState<Record<string, Access>>({})
  const [saving, setSaving] = useState(false)

  const rolePages = member ? pagesForRole(member.role) : []

  useEffect(() => {
    if (!member || member.customRoleId) return
    const allowed = member.allowedPaths ?? []
    const writable = member.writablePaths ?? []
    setAccess(
      // Kısıt yoksa üye bugün rolünün her şeyini yapabiliyor: tam yetkiyle aç.
      allowed.length === 0
        ? Object.fromEntries(pagesForRole(member.role).map((h) => [h, "edit" as Access]))
        : accessFromPaths(pagesForRole(member.role), allowed, writable)
    )
  }, [member])

  if (!member) return null

  const name = member.user?.name || member.user?.email || "Üye"

  // ---- Özel rol: yetki burada değil, rolde düzenlenir --------------------
  if (member.customRoleId) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-kobipo-blue" />
              {name}
            </DialogTitle>
            <DialogDescription>
              Bu çalışanın yetkileri <strong>{member.customRole?.name ?? "özel rol"}</strong>{" "}
              rolünden geliyor. Yetkiyi değiştirmek o rolü kullanan herkesi etkiler; bu
              yüzden kişiye özel düzenleme yapılmaz.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 pt-2">
            <CompanyLink
              href="/ayarlar/roller"
              className="inline-flex items-center gap-1.5 rounded-lg bg-kobipo-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Rolü düzenle
            </CompanyLink>
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Yalnız bu kişiye farklı yetki vermek istiyorsanız Rol Yetkileri ekranından
            yeni bir rol oluşturup buradan atayın.
          </p>
        </DialogContent>
      </Dialog>
    )
  }

  // ---- Hazır enum rol: rolün matrisi içinde daraltma ---------------------
  const roleTotal = rolePages.length
  const hiddenByRole = NAV_PAGES.length - roleTotal
  const selectedCount = rolePages.filter((h) => (access[h] ?? "none") !== "none").length

  const save = async () => {
    if (selectedCount === 0) {
      // "Sıfır sayfa" ifade edilemez: boş liste sunucuda "kısıt yok" demek. Erişimi
      // tamamen kesmenin doğru yolu üyeliği ekipten çıkarmaktır.
      toast({
        title: "En az bir sayfa seçin",
        description: "Erişimi tamamen kapatmak için üyeyi ekipten çıkarın.",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    try {
      const { allowedPaths, writablePaths } = pathsFromAccess(access)
      const response = await fetch(`/api/company/users/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, allowedPaths, writablePaths }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Yetkiler kaydedilemedi")
      }
      toast({ title: "Yetkiler kaydedildi" })
      onSaved()
      onClose()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Yetkiler kaydedilemedi",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-kobipo-blue" />
            {name} — Sayfa Yetkileri
          </DialogTitle>
          <DialogDescription>
            Aşağıda <strong>{roleLabel(member.role)}</strong> rolünün görebildiği {roleTotal}{" "}
            sayfa var; panelin kalan {hiddenByRole} sayfası bu role kapalı ve buradan
            açılamaz. Hepsini işaretlemek "her şeye erişim" değil, "rolünün tamamı"
            demektir. Daha geniş ya da tamamen farklı bir yetki kümesi için Rol
            Yetkileri ekranından özel rol tanımlayın.
          </DialogDescription>
        </DialogHeader>

        <PagePermissionPicker selectableHrefs={rolePages} access={access} onChange={setAccess} />

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
