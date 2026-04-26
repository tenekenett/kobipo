"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

export default function VeriAktarimPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [module, setModule] = useState("customers")
  const [csv, setCsv] = useState("")
  const [importResult, setImportResult] = useState<any>(null)
  const [exportPayload, setExportPayload] = useState<any>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [importFormat, setImportFormat] = useState("xlsx")
  const [exportFormat, setExportFormat] = useState("xlsx")
  const [fileBase64, setFileBase64] = useState("")
  const [fileName, setFileName] = useState("")
  const [dryRun, setDryRun] = useState(false)

  async function runImport() {
    if (!companyId) return
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, module, csv, fileBase64, format: importFormat, dryRun }),
    })
    setImportResult(await response.json())
  }

  async function handleFileChange(file: File | null) {
    if (!file) return
    setFileName(file.name)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ""
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })
    setFileBase64(btoa(binary))
    setCsv("")
  }

  async function runModuleExport() {
    if (!companyId) return
    const params = new URLSearchParams({ companyId, module, format: exportFormat })
    const response = await fetch(`/api/export?${params.toString()}`)
    if (!response.ok) {
      setExportPayload(await response.json())
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const ext = exportFormat === "xml" ? "xml" : exportFormat === "xlsx" ? "xlsx" : "csv"
    const link = document.createElement("a")
    link.href = url
    link.download = `${module}.${ext}`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function runAccountantExport() {
    if (!companyId) return
    const params = new URLSearchParams({ companyId })
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    const response = await fetch(`/api/export/accountant?${params.toString()}`)
    setExportPayload(await response.json())
  }

  if (!companyId) {
    return <div className="p-4 text-muted-foreground">Lütfen firma seçin.</div>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Toplu Veri İçe Aktarım</CardTitle>
          <CardDescription>XLSX, CSV ve UBL/XML import desteklenir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customers">Müşteriler</SelectItem>
                <SelectItem value="suppliers">Tedarikçiler</SelectItem>
                <SelectItem value="products">Ürünler</SelectItem>
                <SelectItem value="invoices">Faturalar</SelectItem>
                <SelectItem value="invoices-ubl">Fatura (UBL/XML)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={importFormat} onValueChange={setImportFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xml">UBL/XML</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="file"
              accept={importFormat === "xml" ? ".xml,text/xml,application/xml" : importFormat === "csv" ? ".csv,text/csv" : ".xlsx"}
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            />
          </div>
          {fileName && <p className="text-xs text-muted-foreground">Seçilen dosya: {fileName}</p>}
          <Textarea
            rows={8}
            placeholder="Opsiyonel: CSV/XML içeriğini yapıştırın"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Önizleme (Dry Run)</p>
              <p className="text-xs text-muted-foreground">
                Açıkken kayıt atılmaz, sadece doğrulama sonucu döner.
              </p>
            </div>
            <Switch checked={dryRun} onCheckedChange={setDryRun} />
          </div>
          <Button onClick={runImport}>İçe Aktar</Button>
          {importResult && (
            <pre className="rounded border p-3 text-xs overflow-auto">
              {JSON.stringify(importResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modül Dışa Aktarım</CardTitle>
          <CardDescription>Faturalarda CSV, XLSX ve UBL/XML dışa aktarma kullanılabilir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customers">Müşteriler</SelectItem>
                <SelectItem value="suppliers">Tedarikçiler</SelectItem>
                <SelectItem value="products">Ürünler</SelectItem>
                <SelectItem value="invoices">Faturalar</SelectItem>
              </SelectContent>
            </Select>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xml">UBL/XML (Fatura)</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runModuleExport}>Dışa Aktar</Button>
          </div>
          {exportPayload && (
            <pre className="rounded border p-3 text-xs overflow-auto max-h-[220px]">
              {JSON.stringify(exportPayload, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Muhasebeci Dışa Aktarım Paketi</CardTitle>
          <CardDescription>Yevmiye, faturalar, finans hareketleri ve cari CSV çıktıları.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Button onClick={runAccountantExport}>Paketi Üret</Button>
          </div>
          {exportPayload && (
            <pre className="rounded border p-3 text-xs overflow-auto max-h-[420px]">
              {JSON.stringify(exportPayload, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
