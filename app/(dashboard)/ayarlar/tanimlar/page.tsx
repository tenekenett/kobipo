"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Check, Pencil, Tag, X } from "lucide-react"
import {
  DEFAULT_CLASSIFICATION_LABELS,
  CLASSIFICATION_LABEL_MAX,
  type ClassificationLabels,
} from "@/lib/company/classification-labels"

type DefinitionType = "CLASS_1" | "CLASS_2"
type CompanyDefinition = {
  id: string
  type: DefinitionType
  label: string
  isActive: boolean
}

/** Eksen adı verilmemişse gösterilen varsayılan başlıklar. */
const TAB_LABEL: Record<DefinitionType, string> = {
  CLASS_1: DEFAULT_CLASSIFICATION_LABELS.class1,
  CLASS_2: DEFAULT_CLASSIFICATION_LABELS.class2,
}

export default function TanimlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<DefinitionType>("CLASS_1")
  const [definitions, setDefinitions] = useState<CompanyDefinition[]>([])
  const [newLabel, setNewLabel] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  // Düzenlenen satır: adı yerinde (inline) değiştirilir — tanım cari kartlarına
  // FK ile bağlı olduğundan yeniden adlandırma tüm kayıtlara anında yansır.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  /**
   * EKSEN adları. Liste "Bayi/Perakende"yi tutuyor; bu ikisi o listenin NE
   * olduğunu söyler ("Müşteri Tipi"). Rapor başlıkları da bunu kullanır.
   */
  const [labels, setLabels] = useState<ClassificationLabels>(DEFAULT_CLASSIFICATION_LABELS)
  const [axisDraft, setAxisDraft] = useState<string | null>(null)
  const [savingAxis, setSavingAxis] = useState(false)

  const axisLabel = (type: DefinitionType) =>
    type === "CLASS_1" ? labels.class1 : labels.class2

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

  const fetchLabels = async () => {
    if (!companyId) return
    const response = await fetch(`/api/company/definitions/labels?companyId=${companyId}`)
    if (!response.ok) return
    setLabels(await response.json())
  }

  useEffect(() => {
    void fetchDefinitions()
    void fetchLabels()
  }, [companyId])

  /** Eksenin adını kaydeder. Boş bırakmak varsayılana ("Sınıflandırma 1") döner. */
  const saveAxisLabel = async (type: DefinitionType, value: string) => {
    if (!companyId) return
    setSavingAxis(true)
    try {
      const response = await fetch(`/api/company/definitions/labels?companyId=${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "CLASS_1" ? { class1: value } : { class2: value }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || "Ad kaydedilemedi")
      }
      setLabels(await response.json())
      setAxisDraft(null)
      toast({ title: "Kaydedildi", description: "Rapor başlıkları bu adla görünecek." })
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Ad kaydedilemedi",
        variant: "destructive",
      })
    } finally {
      setSavingAxis(false)
    }
  }

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

  const startEdit = (item: CompanyDefinition) => {
    setEditingId(item.id)
    setEditingLabel(item.label)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingLabel("")
  }

  const saveEdit = async (id: string) => {
    const label = editingLabel.trim()
    if (!label) return
    setSavingId(id)
    try {
      const response = await fetch(`/api/company/definitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Tanım güncellenemedi")
      }
      cancelEdit()
      await fetchDefinitions()
      toast({ title: "Başarılı", description: "Tanım güncellendi" })
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Tanım güncellenemedi",
        variant: "destructive",
      })
    } finally {
      setSavingId(null)
    }
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const renderTab = (type: DefinitionType) => (
    <TabsContent value={type} className="space-y-3 pt-3">
      {/* Eksenin ADI: listenin öğeleri değil, listenin ne olduğu. Raporlarda ve
          Excel'de sütun başlığı olarak bu ad çıkar. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
        <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
        {axisDraft === null ? (
          <>
            <span className="text-sm">
              Bu listenin adı: <span className="font-medium">{axisLabel(type)}</span>
            </span>
            <WriteAction>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setAxisDraft(axisLabel(type))}
              >
                <Pencil className="mr-1 h-4 w-4" />
                Adını değiştir
              </Button>
            </WriteAction>
          </>
        ) : (
          <>
            <Input
              autoFocus
              className="h-9 flex-1"
              maxLength={CLASSIFICATION_LABEL_MAX}
              placeholder="Ör. Müşteri Tipi, Bölge"
              value={axisDraft}
              onChange={(e) => setAxisDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveAxisLabel(type, axisDraft)
                if (e.key === "Escape") setAxisDraft(null)
              }}
            />
            <Button size="sm" disabled={savingAxis} onClick={() => saveAxisLabel(type, axisDraft)}>
              <Check className="mr-1 h-4 w-4" />
              Kaydet
            </Button>
            <Button variant="ghost" size="sm" disabled={savingAxis} onClick={() => setAxisDraft(null)}>
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`Yeni ${axisLabel(type).toLocaleLowerCase("tr-TR")} adı`}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addDefinition()
          }}
        />
        <WriteAction>
          <Button onClick={addDefinition} disabled={isLoading}>
            Ekle
          </Button>
        </WriteAction>
      </div>
      <div className="space-y-2">
        {currentList.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded border p-2">
            {editingId === item.id ? (
              <>
                <Input
                  autoFocus
                  className="h-9 flex-1"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit(item.id)
                    if (e.key === "Escape") cancelEdit()
                  }}
                />
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    onClick={() => saveEdit(item.id)}
                    disabled={savingId === item.id || !editingLabel.trim()}
                  >
                    <Check className="mr-1 h-4 w-4" />
                    Kaydet
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={savingId === item.id}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className={item.isActive ? "" : "text-muted-foreground line-through"}>
                  {item.label}
                </span>
                <div className="flex shrink-0 gap-1">
                  <WriteAction>
                    <Button variant="outline" size="sm" onClick={() => startEdit(item)} title="Adını değiştir">
                      <Pencil className="mr-1 h-4 w-4" />
                      Düzenle
                    </Button>
                  </WriteAction>
                  <WriteAction>
                    <Button variant="outline" size="sm" onClick={() => toggleDefinition(item.id, item.isActive)}>
                      {item.isActive ? "Pasifleştir" : "Aktifleştir"}
                    </Button>
                  </WriteAction>
                </div>
              </>
            )}
          </div>
        ))}
        {currentList.length === 0 && <p className="text-sm text-muted-foreground">Henüz tanım yok.</p>}
      </div>
    </TabsContent>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tanımlar</CardTitle>
        <CardDescription>
          Carileri iki eksende gruplamak için kullanılır (ör. &quot;Müşteri Tipi&quot; ve
          &quot;Bölge&quot;). Buradaki adlar cari kartında seçilir, raporlarda ve Excel&apos;de
          sütun olarak çıkar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as DefinitionType)
            // Sekme değişince yarım kalan düzenleme kapanır: düzenlenen satır
            // diğer sekmede görünmüyor, açık kalırsa "kayıp" bir form olur.
            cancelEdit()
            setAxisDraft(null)
          }}
        >
          <TabsList>
            <TabsTrigger value="CLASS_1">{labels.class1}</TabsTrigger>
            <TabsTrigger value="CLASS_2">{labels.class2}</TabsTrigger>
          </TabsList>
          {renderTab("CLASS_1")}
          {renderTab("CLASS_2")}
        </Tabs>
      </CardContent>
    </Card>
  )
}
