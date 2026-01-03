"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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

interface Company {
  id: string
  name: string
}

export function CompanySelector() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState("")

  useEffect(() => {
    fetchCompanies()
    const companyId = searchParams.get("company")
    if (companyId) {
      setSelectedCompanyId(companyId)
      localStorage.setItem("selectedCompanyId", companyId)
    } else {
      const stored = localStorage.getItem("selectedCompanyId")
      if (stored) {
        setSelectedCompanyId(stored)
        router.replace(`?company=${stored}`)
      }
    }
  }, [searchParams, router])

  const fetchCompanies = async () => {
    try {
      const response = await fetch("/api/companies")
      if (response.ok) {
        const data = await response.json()
        setCompanies(data)
      }
    } catch (error) {
      console.error("Error fetching companies:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCompanyChange = (companyId: string) => {
    setSelectedCompanyId(companyId)
    localStorage.setItem("selectedCompanyId", companyId)
    router.push(`?company=${companyId}`)
  }

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
        setCompanies([...companies, newCompany])
        setNewCompanyName("")
        setIsDialogOpen(false)
        handleCompanyChange(newCompany.id)
        toast({
          title: "Başarılı",
          description: "Firma oluşturuldu",
        })
      } else {
        throw new Error("Firma oluşturulamadı")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Firma oluşturulurken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  if (isLoading) {
    return (
      <div className="mb-4 flex items-center justify-center rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground">Yükleniyor...</div>
      </div>
    )
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId)

  return (
    <div className="mb-4 flex flex-col space-y-2 rounded-lg border bg-card p-4 md:flex-row md:items-center md:justify-between md:space-y-0">
      <div className="flex flex-col space-y-2 md:flex-row md:items-center md:space-x-4 md:space-y-0">
        <Label className="text-sm font-medium">Firma:</Label>
        <select
          value={selectedCompanyId || ""}
          onChange={(e) => handleCompanyChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:w-auto"
        >
          <option value="">Firma Seçin</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        {selectedCompany && (
          <span className="text-sm text-muted-foreground">
            {selectedCompany.name}
          </span>
        )}
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Yeni Firma</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Firma Oluştur</DialogTitle>
            <DialogDescription>
              Yeni bir firma oluşturmak için firma adını girin
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCompany} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Firma Adı</Label>
              <Input
                id="companyName"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                placeholder="Firma adı"
                required
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                İptal
              </Button>
              <Button type="submit">Oluştur</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

