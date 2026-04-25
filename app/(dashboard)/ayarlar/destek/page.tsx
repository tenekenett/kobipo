"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

export default function DestekPage() {
  const companyId = useSearchParams().get("company")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [tickets, setTickets] = useState<any[]>([])

  const fetchTickets = async () => {
    if (!companyId) return
    const response = await fetch(`/api/support/tickets?companyId=${companyId}`)
    if (response.ok) setTickets(await response.json())
  }
  useEffect(() => { fetchTickets() }, [companyId])

  const createTicket = async () => {
    await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, subject, message }),
    })
    setSubject("")
    setMessage("")
    fetchTickets()
  }

  return (
    <Card>
      <CardHeader><CardTitle>Destek Talepleri</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Konu" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Textarea placeholder="Mesaj" value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button onClick={createTicket}>Talep Aç</Button>
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="rounded border p-2">
              <div className="font-medium">{ticket.subject}</div>
              <div className="text-xs text-muted-foreground">{ticket.status}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
