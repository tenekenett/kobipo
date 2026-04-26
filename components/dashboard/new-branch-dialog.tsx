"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

export function NewBranchDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { toast } = useToast()
  const { selectedCompanyId, fetchCompanies, handleCompanyChange } = useDashboardCompany()
  const [open, setOpen] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState("")

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCompanyName.trim()) return

    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCompanyName }),
      })

      if (response.ok) {
        const newCompany = await response.json()
        await fetchCompanies()
        setNewCompanyName("")
        setOpen(false)
        handleCompanyChange(newCompany.id)
        toast({
          title: "Basarili",
          description: "Sube olusturuldu",
        })
      } else {
        const errorBody = await response.json().catch(() => null)
        if (response.status === 402 || errorBody?.code === "PLAN_LIMIT_EXCEEDED") {
          toast({
            title: "Abonelik gerekli",
            description: "Yeni sube eklemek ucretlidir. Aboneliginizi yukselterek devam edin.",
            variant: "destructive",
          })
          router.push(`/ayarlar/abonelik?company=${selectedCompanyId || ""}`)
          return
        }
        throw new Error("Sube olusturulamadi")
      }
    } catch {
      toast({
        title: "Hata",
        description: "Sube olusturulurken bir hata olustu",
        variant: "destructive",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Sube Olustur</DialogTitle>
          <DialogDescription>Yeni bir sube eklemek icin sube adini girin</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateCompany} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-branch-company-name">Sube Adi</Label>
            <Input
              id="new-branch-company-name"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Sube adi"
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              İptal
            </Button>
            <Button type="submit">Oluştur</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
