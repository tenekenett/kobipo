"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function EkipPage() {
  const companyId = useSearchParams().get("company")
  const [members, setMembers] = useState<any[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("VIEWER")

  const fetchMembers = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/users?companyId=${companyId}`)
    if (response.ok) setMembers(await response.json())
  }
  useEffect(() => { fetchMembers() }, [companyId])

  const invite = async () => {
    const response = await fetch("/api/company/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, email, role }),
    })
    if (response.ok) {
      setEmail("")
      fetchMembers()
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Ekip Yönetimi</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Kullanıcı e-postası" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="rounded border px-2" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="ADMIN">ADMIN</option>
            <option value="ACCOUNTANT">ACCOUNTANT</option>
            <option value="STOCK">STOCK</option>
            <option value="SALES">SALES</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <Button onClick={invite}>Davet Et</Button>
        </div>
        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between rounded border p-2">
              <div>{member.user?.name || member.user?.email}</div>
              <div className="text-sm text-muted-foreground">{member.role}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
