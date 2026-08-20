"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

type DefinitionType = "CLASS_1" | "CLASS_2"
type CompanyDefinition = {
  id: string
  type: DefinitionType
  label: string
  isActive: boolean
}

export default function TanimlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<DefinitionType>("CLASS_1")
  const [definitions, setDefinitions] = useState<CompanyDefinition[]>([])
  const [newLabel, setNewLabel] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const currentList = useMemo(
    () => definitions.filter((item) => item.type === activeTab),
    [definitions, activeTab]
  )

  const fetchDefinitions = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/definitions?companyId=${companyId}&includeInactive=true`)
    if (!response.ok) return
    setDefinitions(await response.json())
  }

  useEffect(() => {
    void fetchDefinitions()
  }, [companyId])

  const addDefinition = async () => {
    if (!companyId || !newLabel.trim()) return
    setIsLoading(true)
    try {
      const response = await fetch("/api/company/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: activeTab,
          label: newLabel.trim(),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Tanım eklenemedi")
      }
      setNewLabel("")
      await fetchDefinitions()
      toast({ title: "Başarılı", description: "Tanım eklendi" })
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Tanım eklenemedi",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const toggleDefinition = async (id: string, isActive: boolean) => {
    const response = await fetch(`/api/company/definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    })
    if (!response.ok) {
      toast({ title: "Hata", description: "Durum güncellenemedi", variant: "destructive" })
      return
    }
    await fetchDefinitions()
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tanımlar</CardTitle>
        <CardDescription>Sınıflandırma listelerini firma bazında yönetin</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DefinitionType)}>
          <TabsList>
            <TabsTrigger value="CLASS_1">Sınıflandırma 1</TabsTrigger>
            <TabsTrigger value="CLASS_2">Sınıflandırma 2</TabsTrigger>
          </TabsList>
          <TabsContent value="CLASS_1" className="space-y-3 pt-3">
            <div className="flex gap-2">
              <Input
                placeholder="Yeni sınıflandırma 1 adı"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <WriteAction><Button onClick={addDefinition} disabled={isLoading}>
                Ekle
              </Button></WriteAction>
            </div>
            <div className="space-y-2">
              {currentList.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded border p-2">
                  <span className={item.isActive ? "" : "text-muted-foreground line-through"}>{item.label}</span>
                  <Button variant="outline" size="sm" onClick={() => toggleDefinition(item.id, item.isActive)}>
                    {item.isActive ? "Pasifleştir" : "Aktifleştir"}
                  </Button>
                </div>
              ))}
              {currentList.length === 0 && (
                <p className="text-sm text-muted-foreground">Henüz tanım yok.</p>
              )}
            </div>
          </TabsContent>
          <TabsContent value="CLASS_2" className="space-y-3 pt-3">
            <div className="flex gap-2">
              <Input
                placeholder="Yeni sınıflandırma 2 adı"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <WriteAction><Button onClick={addDefinition} disabled={isLoading}>
                Ekle
              </Button></WriteAction>
            </div>
            <div className="space-y-2">
              {currentList.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded border p-2">
                  <span className={item.isActive ? "" : "text-muted-foreground line-through"}>{item.label}</span>
                  <Button variant="outline" size="sm" onClick={() => toggleDefinition(item.id, item.isActive)}>
                    {item.isActive ? "Pasifleştir" : "Aktifleştir"}
                  </Button>
                </div>
              ))}
              {currentList.length === 0 && (
                <p className="text-sm text-muted-foreground">Henüz tanım yok.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
