"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Search } from "lucide-react"

interface Customer {
  id: string
  code?: string
  name: string
  taxNumber?: string
  email?: string
  phone?: string
  balance?: number
}

export default function CariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Customer[]>([])
  const [activeTab, setActiveTab] = useState<"customers" | "suppliers">("customers")
  const [search, setSearch] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    email: "",
    contactPerson: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchData()
    }
  }, [companyId, activeTab, search])

  const fetchData = async () => {
    if (!companyId) return

    try {
      const endpoint = activeTab === "customers" ? "customers" : "suppliers"
      const response = await fetch(
        `/api/cari/${endpoint}?companyId=${companyId}&search=${search}`
      )
      if (response.ok) {
        const data = await response.json()
        if (activeTab === "customers") {
          setCustomers(data)
        } else {
          setSuppliers(data)
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const endpoint = activeTab === "customers" ? "customers" : "suppliers"
      const response = await fetch(`/api/cari/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, companyId }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: `${activeTab === "customers" ? "Müşteri" : "Tedarikçi"} oluşturuldu`,
        })
        setIsDialogOpen(false)
        setFormData({
          code: "",
          name: "",
          taxNumber: "",
          taxOffice: "",
          address: "",
          city: "",
          phone: "",
          email: "",
          contactPerson: "",
        })
        fetchData()
      } else {
        throw new Error("Oluşturulamadı")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const currentData = activeTab === "customers" ? customers : suppliers

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cari Hesaplar</h1>
          <p className="text-muted-foreground">
            Müşteri ve tedarikçi yönetimi
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Yeni {activeTab === "customers" ? "Müşteri" : "Tedarikçi"}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Yeni {activeTab === "customers" ? "Müşteri" : "Tedarikçi"}
              </DialogTitle>
              <DialogDescription>
                {activeTab === "customers" ? "Müşteri" : "Tedarikçi"} bilgilerini
                girin
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="code">Kod</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Ad *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxNumber">Vergi No</Label>
                  <Input
                    id="taxNumber"
                    value={formData.taxNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, taxNumber: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxOffice">Vergi Dairesi</Label>
                  <Input
                    id="taxOffice"
                    value={formData.taxOffice}
                    onChange={(e) =>
                      setFormData({ ...formData, taxOffice: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Adres</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Şehir</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) =>
                      setFormData({ ...formData, city: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPerson">İletişim Kişisi</Label>
                  <Input
                    id="contactPerson"
                    value={formData.contactPerson}
                    onChange={(e) =>
                      setFormData({ ...formData, contactPerson: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isLoading}
                >
                  İptal
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex space-x-2 border-b">
        <Button
          variant={activeTab === "customers" ? "default" : "ghost"}
          onClick={() => setActiveTab("customers")}
        >
          Müşteriler
        </Button>
        <Button
          variant={activeTab === "suppliers" ? "default" : "ghost"}
          onClick={() => setActiveTab("suppliers")}
        >
          Tedarikçiler
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {activeTab === "customers" ? "Müşteriler" : "Tedarikçiler"}
              </CardTitle>
              <CardDescription>
                Toplam {currentData.length} kayıt
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Ad</TableHead>
                <TableHead>Vergi No</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    Kayıt bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                currentData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.code || "-"}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.taxNumber || "-"}</TableCell>
                    <TableCell>{item.phone || "-"}</TableCell>
                    <TableCell>{item.email || "-"}</TableCell>
                    <TableCell className="text-right">
                      {item.balance !== undefined
                        ? new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(item.balance)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

