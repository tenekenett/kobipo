import { EInvoiceProvider, InvoiceData, EInvoiceResponse, EInvoiceStatus, IncomingInvoiceParams, IncomingInvoice } from "./types"

export abstract class BaseEInvoiceProvider implements EInvoiceProvider {
  abstract name: string

  abstract sendInvoice(invoice: InvoiceData): Promise<EInvoiceResponse>
  abstract getInvoiceStatus(uuid: string): Promise<EInvoiceStatus>
  abstract getIncomingInvoices(params: IncomingInvoiceParams): Promise<IncomingInvoice[]>

  protected validateInvoiceData(invoice: InvoiceData): boolean {
    if (!invoice.invoiceNo || !invoice.date) {
      return false
    }
    if (!invoice.items || invoice.items.length === 0) {
      return false
    }
    return true
  }
}

