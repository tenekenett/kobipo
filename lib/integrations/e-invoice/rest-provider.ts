import { BaseEInvoiceProvider } from "./base"
import { EInvoiceResponse, EInvoiceStatus, IncomingInvoice, IncomingInvoiceParams, InvoiceData } from "./types"

type RestProviderConfig = {
  name: string
  baseUrl: string
  apiKey: string
}

export class RestEInvoiceProvider extends BaseEInvoiceProvider {
  name: string
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(config: RestProviderConfig) {
    super()
    this.name = config.name
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.apiKey = config.apiKey
  }

  private get headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  async sendInvoice(invoice: InvoiceData): Promise<EInvoiceResponse> {
    if (!this.validateInvoiceData(invoice)) {
      return { success: false, error: "Invalid invoice data" }
    }

    const response = await fetch(`${this.baseUrl}/invoices`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(invoice),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: errorText || "Provider request failed" }
    }

    const data = await response.json()
    return {
      success: true,
      uuid: data.uuid || data.id,
      message: data.message || "Invoice sent",
    }
  }

  async getInvoiceStatus(uuid: string): Promise<EInvoiceStatus> {
    const response = await fetch(`${this.baseUrl}/invoices/${uuid}`, {
      headers: this.headers,
    })
    if (!response.ok) {
      return { status: "PENDING", uuid, message: "Durum alınamadı" }
    }
    const data = await response.json()
    return {
      status: data.status || "PENDING",
      uuid,
      message: data.message,
    }
  }

  async getIncomingInvoices(params: IncomingInvoiceParams): Promise<IncomingInvoice[]> {
    const query = new URLSearchParams()
    if (params.startDate) query.set("startDate", params.startDate.toISOString())
    if (params.endDate) query.set("endDate", params.endDate.toISOString())
    if (params.status) query.set("status", params.status)

    const response = await fetch(`${this.baseUrl}/incoming?${query.toString()}`, {
      headers: this.headers,
    })
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data) ? data : []
  }
}
