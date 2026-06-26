"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Building2, Plus, Trash2, UserCog, Clock } from "lucide-react"

interface Manager {
  membershipId: string
  userId: string
  name: string | null
  email: string
}
interface PendingInvite {
  id: string
  email: string
  createdAt: string
}
interface Unit {
  id: string
  name: string
  isBranch: boolean
  parentName: string | null
  managers: Manager[]
  invitations: PendingInvite[]
}

export default function SubeMudurleriPage() {
  const { toast } = useToast()
  const [units, setUnits] = useState<Unit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [emailByUnit, setEmailByUnit] = useState<Record<string, string>>({})
  const [savingUnit, setSavingUnit] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/company/branch-managers", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        setUnits(Array.isArray(data.branches) ? data.branches : [])
      } else {
        setUnits([])
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const assign = async (companyId: string) => {
    const email = (emailByUnit[companyId] || "").trim()
    if (!email) {
      toast({ title: "E-posta gerekli", description: "Atanacak kullanıcının e-postasını girin.", variant: "destructive" })
      return
    }
    setSavingUnit(companyId)
    try {
      const res = await fetch("/api/company/branch-managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Hata", description: data.error || "Müdür atanamadı", variant: "destructive" })
        return
      }
      setEmailByUnit((prev) => ({ ...prev, [companyId]: "" }))
      if (data.status === "invited") {
        toast({
          title: "Davet oluşturuldu",
          description: "Kullanıcı kayıtlı değil; davet e-postası gönderildi. Kabul edince müdür olacak.",
        })
      } else {
        toast({ title: "Atandı", description: "Kullanıcı şube müdürü olarak atandı." })
      }
      fetchData()
    } finally {
      setSavingUnit(null)
    }
  }

  const removeManager = async (membershipId: string) => {
    const res = await fetch(
      `/api/company/branch-managers?membershipId=${encodeURIComponent(membershipId)}`,
      { method: "DELETE" }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data.error || "Kaldırılamadı", variant: "destructive" })
      return
    }
    toast({ title: "Kaldırıldı", description: "Şube müdürü ataması kaldırıldı." })
    fetchData()
  }

  const cancelInvite = async (invitationId: string) => {
    const res = await fetch(
      `/api/company/branch-managers?invitationId=${encodeURIComponent(invitationId)}`,
      { method: "DELETE" }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data.error || "Davet iptal edilemedi", variant: "destructive" })
      return
    }
    toast({ title: "İptal edildi", description: "Bekleyen davet iptal edildi." })
    fetchData()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-kobipo-navy dark:text-foreground">
          <UserCog className="h-6 w-6 text-teal-500" />
          Şube Müdürleri
        </h1>
        <p className="text-sm text-muted-foreground">
          Firmalarınıza ve şubelerinize müdür atayın. Şube müdürü, ilgili birimde operasyonel olarak tüm
          yetkilere sahip olur; ancak kullanıcı yönetimi, şube oluşturma ve abonelik gibi hesap işlemlerini yapamaz.
        </p>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>
      ) : units.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium">Yönetebileceğiniz firma/şube yok</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Yalnızca yöneticisi olduğunuz firmalara ve onların şubelerine müdür atayabilirsiniz.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {units.map((unit) => (
            <Card key={unit.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                    <Building2 className="h-4 w-4" />
                  </span>
                  {unit.name}
                  {unit.isBranch ? (
                    <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                      Şube{unit.parentName ? ` · ${unit.parentName}` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Ana firma
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {unit.managers.length === 0 && unit.invitations.length === 0 && (
                  <p className="text-sm text-muted-foreground">Henüz müdür atanmadı.</p>
                )}

                {unit.managers.map((m) => (
                  <div key={m.membershipId} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name || m.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => removeManager(m.membershipId)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Kaldır
                    </Button>
                  </div>
                ))}

                {unit.invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed p-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm">
                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                        {inv.email}
                      </div>
                      <div className="text-xs text-muted-foreground">Davet bekleniyor</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => cancelInvite(inv.id)}>
                      İptal
                    </Button>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Input
                    className="max-w-xs"
                    placeholder="Müdür e-postası"
                    value={emailByUnit[unit.id] || ""}
                    onChange={(e) =>
                      setEmailByUnit((prev) => ({ ...prev, [unit.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") assign(unit.id)
                    }}
                  />
                  <Button onClick={() => assign(unit.id)} disabled={savingUnit === unit.id}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    {savingUnit === unit.id ? "Atanıyor…" : "Müdür Ata"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
