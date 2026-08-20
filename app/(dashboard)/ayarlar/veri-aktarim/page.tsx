"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { AlertCircle } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"

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
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState(0)

  const importFormatOptions = useMemo(() => {
    if (module === "invoices-ubl") {
      return [{ value: "xml", label: "UBL/XML" }]
    }
    return [
      { value: "xlsx", label: "XLSX" },
      { value: "csv", label: "CSV" },
    ]
  }, [module])

  const importAccept = useMemo(() => {
    if (importFormat === "xml") return ".xml,text/xml,application/xml"
    if (importFormat === "csv") return ".csv,text/csv"
    return ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
  }, [importFormat])

  useEffect(() => {
    const allowed = importFormatOptions.map((option) => option.value)
    if (!allowed.includes(importFormat)) {
      setImportFormat(allowed[0])
    }
    setFileBase64("")
    setFileName("")
    setCsv("")
  }, [importFormat, importFormatOptions])

  async function runImport() {
    if (!companyId) return
    setIsImporting(true)
    setProgress(0)

    try {
      // Simüle etme: ilerleme göster
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          const next = prev + Math.random() * 30
          return Math.min(next, 90)
        })
      }, 200)

      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, module, csv, fileBase64, format: importFormat, dryRun }),
      })

      clearInterval(progressInterval)
      setProgress(100)

      const data = await response.json()
      setImportResult(data)
    } finally {
      setIsImporting(false)
      setTimeout(() => setProgress(0), 500)
    }
  }

  async function downloadImportTemplate() {
    const templateRowsByModule: Record<string, Record<string, string | number>[]> = {
      customers: [
        {
          Kod: "CARI-001",
          Ad: "ABC Müşteri A.Ş.",
          "Vergi No": "1234567890",
          "Vergi Dairesi": "Mecidiyeköy VD",
          Telefon: "0212 000 00 00",
          Eposta: "musteri@example.com",
          Adres: "Örnek Mah. No:1",
          Sehir: "İstanbul",
          "Yetkili Kişi": "Ahmet Yılmaz",
          "Vade (Gün)": 30,
          "Açılış Bakiyesi": 15000,
          "Bakiye Türü": "Borç",
          "Risk Limiti": 50000,
          "Banka Bilgisi": "TR00 0000 0000 0000 0000 0000 00",
          Not: "Örnek müşteri notu",
        },
      ],
      suppliers: [
        {
          Kod: "TED-001",
          Ad: "XYZ Tedarik Ltd.",
          "Vergi No": "0987654321",
          "Vergi Dairesi": "Çankaya VD",
          Telefon: "0312 000 00 00",
          Eposta: "tedarikci@example.com",
          Adres: "Sanayi Cad. No:15",
          Sehir: "Ankara",
          "Yetkili Kişi": "Ayşe Kaya",
          "Vade (Gün)": 45,
          "Açılış Bakiyesi": 5000,
          "Bakiye Türü": "Alacak",
          "Risk Limiti": 30000,
          "Banka Bilgisi": "TR11 1111 1111 1111 1111 1111 11",
          Not: "Örnek tedarikçi notu",
        },
      ],
      products: [
        {
          Kod: "URUN-001",
          Ad: "Örnek Ürün",
          Barkod: "8690000000001",
          Birim: "ADET",
          "Stok Miktarı": 10,
          "Alış Fiyatı": 100,
          "Satış Fiyatı": 150,
          "KDV Oranı": 20,
        },
      ],
      invoices: [
        {
          "Fatura No": "FAT-2026-0001",
          Tarih: "2026-01-01",
          Tip: "SALES",
          "Fatura Tipi": "MANUAL",
          "Net Tutar": 1000,
          "KDV Tutarı": 200,
          "Toplam Tutar": 1200,
          "Para Birimi": "TRY",
          Açıklama: "Örnek fatura",
        },
      ],
    }

    const rows = templateRowsByModule[module]
    if (!rows || rows.length === 0) return

    const XLSX = await import("xlsx")
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "template")
    const fileBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    const blob = new Blob([fileBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${module}-template.xlsx`
    link.click()
    URL.revokeObjectURL(url)
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
      {/* İçe aktarım YAZMA ekranıdır (POST /api/import): dosya seçtirip
          "İçe Aktar"da reddetmek yerine kart hiç kurulmaz. Dışa aktarım
          kartları okuma olduğu için duruyor. */}
      <WriteAction>
        <Card>
          <CardHeader>
            <CardTitle>Toplu Veri İçe Aktarım</CardTitle>
            <CardDescription>
              Modüle göre desteklenen dosya formatını seçip yükleyin.
            </CardDescription>
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
                  {importFormatOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="file"
                accept={importAccept}
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Desteklenen formatlar</p>
              <p>
                {module === "invoices-ubl"
                  ? "UBL Fatura içe aktarma için yalnızca XML kabul edilir. (Tek XML = tek fatura)"
                  : "Müşteri, tedarikçi, ürün ve fatura içe aktarmada CSV veya XLSX kullanın."}
              </p>
            </div>
            {module !== "invoices-ubl" && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={downloadImportTemplate}>
                  Örnek Şablon İndir (XLSX)
                </Button>
              </div>
            )}
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
            <Button onClick={runImport} disabled={isImporting || !fileBase64 && !csv}>
              {isImporting ? "İçe Aktarılıyor..." : "İçe Aktar"}
            </Button>

            {/* Progress Bar */}
            {isImporting && (
              <div className="w-full space-y-2">
                <div className="flex justify-between text-sm">
                  <span>İçe aktarım devam ediyor...</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-muted">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Sonuçlar ve Uyarılar */}
            {importResult && (
              <div className="space-y-3">
                {/* Duplicate Uyarıları */}
                {importResult.errors?.some((err: any) => err.error.includes("Çift")) && (
                  <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
                    <div className="flex gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-900">Çift Kayıtlar Bulundu</p>
                        <p className="text-sm text-yellow-800 mt-1">
                          Aşağıdaki satırlarda zaten mevcut olan kayıtlar atlanmıştır:
                        </p>
                        <ul className="text-sm text-yellow-800 mt-2 space-y-1 list-disc list-inside">
                          {importResult.errors
                            ?.filter((err: any) => err.error.includes("Çift"))
                            .map((err: any, idx: number) => (
                              <li key={idx}>
                                <strong>Satır {err.row}:</strong> {err.error}
                              </li>
                            ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Başarılı/Başarısız Özet */}
                <div className={`rounded-md p-3 ${
                  importResult.failed > 0
                    ? "bg-red-50 border border-red-200"
                    : "bg-green-50 border border-green-200"
                }`}>
                  <p className={importResult.failed > 0 ? "text-red-900 font-medium" : "text-green-900 font-medium"}>
                    {importResult.imported} kayıt başarıyla içe aktarıldı
                    {importResult.failed > 0 && `, ${importResult.failed} hata`}
                  </p>
                </div>

                {/* Diğer Hatalar */}
                {importResult.errors?.filter((err: any) => !err.error.includes("Çift")).length > 0 && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3">
                    <p className="text-sm font-medium text-red-900">Diğer Hatalar:</p>
                    <pre className="text-xs text-red-800 mt-2 overflow-auto">
                      {JSON.stringify(
                        importResult.errors?.filter((err: any) => !err.error.includes("Çift")),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}

                {/* Tam Detay */}
                <details className="cursor-pointer">
                  <summary className="text-sm text-muted-foreground hover:text-foreground">
                    Tam Sonuç Detaylarını Göster
                  </summary>
                  <pre className="rounded border p-3 text-xs overflow-auto mt-2 bg-muted/40">
                    {JSON.stringify(importResult, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      </WriteAction>

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
