"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { CompanyLink } from "@/components/dashboard/company-link"
import { roleLabel } from "@/lib/auth/role-labels"
import { KeyRound, Link2Off, ShieldCheck } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"

/**
 * Personel kartının Kobipo hesabıyla bağı.
 *
 * YETKİ BURADA DEĞİL: izinler üyelikte (UserCompany) yaşar ve Ekip Yönetimi'nden
 * verilir. Bunun iki sebebi var — personel modülü satın alınmamış bir firmada da
 * kısıtlı çalışan tanımlanabilmeli, ve personel kartı olmayan ortak/muhasebeci de
 * hesap alabilmeli. Buradaki bağ yalnızca eşleştirme: "bu kart = bu hesap".
 *
 * Bağ kurulduğunda kazanılan şey, yetki ekranına buradan tek tıkla gidebilmek ve
 * vardiya/ikram kayıtlarının hesapla birleşmesi.
 */

type Member = {
  id: string
  role: string
  allowedPaths?: string[]
  user?: { id: string; name?: string | null; email: string }
}

export function EmployeeAccountCard({
  employeeId,
  companyId,
  linkedUser,
  onChanged,
}: {
  employeeId: string
  companyId: string | null
  linkedUser?: { id: string; name?: string | null; email: string } | null
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/company/users?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setMembers(Array.isArray(data) ? data : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [companyId])

  const save = async (userId: string | null) => {
    setSaving(true)
    try {
      const response = await fetch(
        `/api/personel/employees/${employeeId}?companyId=${encodeURIComponent(companyId ?? "")}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Hesap bağlanamadı")
      }
      toast({ title: userId ? "Hesap bağlandı" : "Hesap bağı kaldırıldı" })
      setSelected("")
      onChanged()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hesap bağlanamadı",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const membership = members.find((m) => m.user?.id === linkedUser?.id)
  const restricted = (membership?.allowedPaths?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Kobipo Hesabı
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {linkedUser ? (
          <>
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">{linkedUser.name || linkedUser.email}</div>
              <div className="text-xs text-muted-foreground">{linkedUser.email}</div>
              {membership && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {roleLabel(membership.role)}
                  {" · "}
                  {restricted ? `${membership.allowedPaths?.length} sayfa ile sınırlı` : "Tam yetki"}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <CompanyLink
                href="/ayarlar/ekip"
                className="inline-flex items-center gap-1.5 rounded-lg bg-kobipo-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Yetkileri düzenle
              </CompanyLink>
              <WriteAction>
                <Button variant="outline" size="sm" disabled={saving} onClick={() => save(null)}>
                  <Link2Off className="mr-1.5 h-3.5 w-3.5" />
                  Bağı kaldır
                </Button>
              </WriteAction>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Bu personelin panele giriş yapan bir hesabı yok. Ekipteki bir hesabı bağlayın;
              yetkileri Ekip Yönetimi'nden sayfa sayfa sınırlayabilirsiniz.
            </p>
            <WriteAction>
            <div className="flex gap-2">
              <select
                className="flex-1 rounded border px-2 py-1.5 text-sm"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Hesap seçin…</option>
                {members
                  .filter((m) => m.user)
                  .map((m) => (
                    <option key={m.id} value={m.user!.id}>
                      {m.user!.name || m.user!.email}
                    </option>
                  ))}
              </select>
              <Button size="sm" disabled={!selected || saving} onClick={() => save(selected)}>
                Bağla
              </Button>
            </div>
            </WriteAction>
            <CompanyLink href="/ayarlar/ekip" className="inline-block text-xs text-kobipo-blue hover:underline">
              Listede yok mu? Ekip Yönetimi'nden davet edin →
            </CompanyLink>
          </>
        )}
      </CardContent>
    </Card>
  )
}
