"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function EkipPage() {
  const { toast } = useToast()
  const companyId = useSearchParams().get("company")
  const [members, setMembers] = useState<Array<{ id: string; role: string; user?: { name?: string; email: string } }>>([])
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
  const fetchInvitations = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/invitations?companyId=${companyId}`)
    if (response.ok) setInvitations(await response.json())
  }
  useEffect(() => { fetchInvitations() }, [companyId])

  const invite = async () => {
    if (!companyId) return
    const response = await fetch("/api/company/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, email, role }),
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
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div>{member.user?.name || member.user?.email}</div>
                  <div className="text-xs text-muted-foreground">{member.user?.email}</div>
                </div>
                <div className="text-sm text-muted-foreground">{member.role}</div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground">Henüz ekip üyesi yok.</p>
            )}
          </TabsContent>
          <TabsContent value="invites" className="space-y-3 pt-3">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Kullanıcı e-postası" value={email} onChange={(e) => setEmail(e.target.value)} />
              <select className="rounded border px-2 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="ADMIN">ADMIN</option>
                <option value="ACCOUNTANT">ACCOUNTANT</option>
                <option value="STOCK">STOCK</option>
                <option value="SALES">SALES</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <Button onClick={invite}>Davet Oluştur</Button>
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
                    {invitation.role} - {new Date(invitation.createdAt).toLocaleDateString("tr-TR")}
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
    </Card>
  )
}
