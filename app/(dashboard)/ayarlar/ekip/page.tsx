"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { roleLabel } from "@/lib/auth/role-labels"
import { pagesForRole } from "@/lib/nav/pages"
import { MemberPermissionsDialog } from "@/components/dashboard/member-permissions-dialog"
import { RoleEditorDialog } from "@/components/dashboard/role-editor-dialog"
import { Pencil, Plus } from "lucide-react"

// BRANCH_MANAGER bilerek yok: şube müdürü ataması ayrı bir ekrandan yapılır
// (/ayarlar/sube-mudurleri), çünkü rol şubeye bağlanır.
const INVITABLE_ROLES = ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"] as const

type Member = {
  id: string
  role: string
  allowedPaths?: string[]
  writablePaths?: string[]
  customRoleId?: string | null
  customRole?: { id: string; name: string; allowedPaths: string[] } | null
  user?: { name?: string; email: string }
}

type CompanyRole = {
  id: string
  name: string
  description?: string | null
  templateKey?: string | null
  allowedPaths: string[]
  writablePaths: string[]
}

export default function EkipPage() {
  const { toast } = useToast()
  const companyId = useSearchParams().get("company")
  const [editing, setEditing] = useState<Member | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [companyRoles, setCompanyRoles] = useState<CompanyRole[]>([])
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  // Diyalog hem "yeni rol" hem "seçili rolü düzenle" için açılıyor; hangisi olduğunu
  // bu belirler. null bırakılırsa diyalog POST atar — düzenleme sanılan akışın 409
  // vermesinin ikinci kaynağı buydu.
  const [editingRole, setEditingRole] = useState<CompanyRole | null>(null)
  const [invitations, setInvitations] = useState<Array<{ id: string; email: string; role: string; createdAt: string }>>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("VIEWER")
  const [latestInviteUrl, setLatestInviteUrl] = useState("")

  const fetchMembers = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/users?companyId=${companyId}`)
    if (response.ok) setMembers(await response.json())
  }
  useEffect(() => { fetchMembers() }, [companyId])
  const fetchCompanyRoles = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/roles?companyId=${companyId}`)
    if (response.ok) setCompanyRoles(await response.json())
  }
  useEffect(() => { fetchCompanyRoles() }, [companyId])

  // Davet formunda seçili olan özel rol (varsa) — düzenleme düğmesi buna bağlanır.
  const selectedCustomRole = role.startsWith("custom:")
    ? companyRoles.find((r) => r.id === role.slice(7)) ?? null
    : null

  // Üyenin rolünü değiştirir. Değer "custom:<id>" ise özel rol, aksi halde enum rol.
  const changeRole = async (member: Member, value: string) => {
    const body: Record<string, unknown> = { companyId }
    if (value.startsWith("custom:")) body.customRoleId = value.slice(7)
    else {
      body.role = value
      body.customRoleId = null
    }
    const response = await fetch(`/api/company/users/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      toast({ title: "Rol değiştirilemedi", description: data.error, variant: "destructive" })
      return
    }
    toast({ title: "Rol güncellendi" })
    fetchMembers()
  }

  const fetchInvitations = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/invitations?companyId=${companyId}`)
    if (response.ok) setInvitations(await response.json())
  }
  useEffect(() => { fetchInvitations() }, [companyId])

  const invite = async () => {
    if (!companyId) return
    // "custom:<id>" → özel rol, aksi halde hazır enum rol.
    const payload = role.startsWith("custom:")
      ? { companyId, email, customRoleId: role.slice(7) }
      : { companyId, email, role }
    const response = await fetch("/api/company/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (response.ok) {
      const result = await response.json()
      setEmail("")
      if (result.status === "invited") {
        setLatestInviteUrl(result.inviteUrl)
        toast({ title: "Davet oluşturuldu", description: "Davet linkini çalışanınıza iletebilirsiniz." })
      } else {
        setLatestInviteUrl("")
        toast({ title: "Kullanıcı eklendi", description: "Mevcut kullanıcı firmaya doğrudan eklendi." })
      }
      fetchMembers()
      fetchInvitations()
      return
    }
    const data = await response.json()
    toast({ title: "Hata", description: data.error || "Davet oluşturulamadı", variant: "destructive" })
  }

  const removeInvitation = async (id: string) => {
    const response = await fetch(`/api/company/invitations/${id}`, { method: "DELETE" })
    if (!response.ok) return
    fetchInvitations()
  }

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url)
    toast({ title: "Kopyalandı", description: "Davet linki panoya kopyalandı." })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ekip Yönetimi</CardTitle>
        <CardDescription>Firma kullanıcılarını yönetin ve yeni kullanıcılar davet edin</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Üyeler</TabsTrigger>
            <TabsTrigger value="invites">Davetler</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="space-y-2 pt-3">
            {members.map((member) => {
              const restricted = (member.allowedPaths?.length ?? 0) > 0
              // Rolün TOPLAM sayfa sayısı. "Tam yetki" tek başına yanıltıcıydı: kısıtsız
              // bir Görüntüleyici de "tam yetkili" görünüyordu, oysa panelin çok küçük
              // bir kısmını görüyor. Kısıt yokluğu ≠ her şeye erişim; tavanı rol koyar.
              const roleTotal = pagesForRole(member.role).length
              return (
                <div key={member.id} className="flex items-center justify-between gap-3 rounded border p-2">
                  <div className="min-w-0">
                    <div className="truncate">{member.user?.name || member.user?.email}</div>
                    <div className="truncate text-xs text-muted-foreground">{member.user?.email}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <select
                        className="rounded border px-2 py-1 text-sm"
                        value={member.customRoleId ? `custom:${member.customRoleId}` : member.role}
                        onChange={(e) => changeRole(member, e.target.value)}
                      >
                        <optgroup label="Hazır roller">
                          {INVITABLE_ROLES.map((value) => (
                            <option key={value} value={value}>
                              {roleLabel(value)}
                            </option>
                          ))}
                        </optgroup>
                        {companyRoles.length > 0 && (
                          <optgroup label="Firmanızın rolleri">
                            {companyRoles.map((r) => (
                              <option key={r.id} value={`custom:${r.id}`}>
                                {r.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {/* Payda her zaman yetkinin TAVANI: özel rolde rolün kendi sayfa
                          sayısı, hazır rolde o rolün matrisi. */}
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {member.customRoleId
                          ? `${member.customRole?.allowedPaths?.length ?? 0} sayfa (özel rol)`
                          : restricted
                            ? `${member.allowedPaths?.length}/${roleTotal} sayfa`
                            : `Rolünün tümü (${roleTotal} sayfa)`}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditing(member)}>
                      Yetkiler
                    </Button>
                  </div>
                </div>
              )
            })}
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground">Henüz ekip üyesi yok.</p>
            )}
          </TabsContent>
          <TabsContent value="invites" className="space-y-3 pt-3">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Kullanıcı e-postası" value={email} onChange={(e) => setEmail(e.target.value)} />
              <select className="rounded border px-2 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
                <optgroup label="Hazır roller">
                  {INVITABLE_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </optgroup>
                {companyRoles.length > 0 && (
                  <optgroup label="Firmanızın rolleri">
                    {companyRoles.map((r) => (
                      <option key={r.id} value={`custom:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <Button onClick={invite}>Davet Oluştur</Button>
            </div>
            {/* Rol tanımlamak için sayfa değiştirmek gerekmesin: çalışan eklerken
                aklına gelen rolü burada açıp aynı akışta seçebilmeli. */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>İstediğiniz yetki kümesi listede yok mu?</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingRole(null)
                  setRoleDialogOpen(true)
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Yeni rol tanımla
              </Button>
              {selectedCustomRole && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingRole(selectedCustomRole)
                    setRoleDialogOpen(true)
                  }}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> “{selectedCustomRole.name}” rolünü düzenle
                </Button>
              )}
            </div>
            {latestInviteUrl && (
              <div className="rounded border p-3">
                <p className="mb-2 text-sm font-medium">Son oluşturulan davet linki</p>
                <div className="flex gap-2">
                  <Input value={latestInviteUrl} readOnly />
                  <Button variant="outline" onClick={() => copyLink(latestInviteUrl)}>Kopyala</Button>
                </div>
              </div>
            )}
            {invitations.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div>{invitation.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {roleLabel(invitation.role)} - {new Date(invitation.createdAt).toLocaleDateString("tr-TR")}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => removeInvitation(invitation.id)}>
                  İptal Et
                </Button>
              </div>
            ))}
            {invitations.length === 0 && (
              <p className="text-sm text-muted-foreground">Bekleyen davet bulunmuyor.</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <MemberPermissionsDialog
        member={editing}
        companyId={companyId}
        onClose={() => setEditing(null)}
        onSaved={fetchMembers}
      />

      {/* Yeni rol aynı akışta tanımlanır ve kaydedilir kaydedilmez davet formunda
          seçili hale gelir — kullanıcı iki ekran arasında gidip gelmesin. */}
      <RoleEditorDialog
        open={roleDialogOpen}
        role={editingRole}
        companyId={companyId}
        existingRoles={companyRoles}
        onClose={() => {
          setRoleDialogOpen(false)
          setEditingRole(null)
        }}
        onSaved={(created) => {
          fetchCompanyRoles()
          if (created?.id) setRole(`custom:${created.id}`)
        }}
      />
    </Card>
  )
}
