import { BaseEInvoiceProvider } from "./base"
import { InvoiceData, EInvoiceResponse, EInvoiceStatus, IncomingInvoiceParams, IncomingInvoice } from "./types"

export class MockEInvoiceProvider extends BaseEInvoiceProvider {
  name = "Mock Provider"

  async sendInvoice(invoice: InvoiceData): Promise<EInvoiceResponse> {
    if (!this.validateInvoiceData(invoice)) {
      return {
        success: false,
        error: "Invalid invoice data",
      }
    }

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const uuid = `MOCK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    return {
      success: true,
      uuid,
      message: "Invoice sent successfully (Mock)",
    }
  }

  async getInvoiceStatus(uuid: string): Promise<EInvoiceStatus> {
    await new Promise((resolve) => setTimeout(resolve, 500))

    return {
      status: "SENT",
      uuid,
      message: "Invoice status retrieved (Mock)",
    }
  }

  async getIncomingInvoices(params: IncomingInvoiceParams): Promise<IncomingInvoice[]> {
    await new Promise((resolve) => setTimeout(resolve, 500))

    return [
      {
        uuid: `INCOMING-${Date.now()}`,
        invoiceNo: "FAT-2024-001",
        date: new Date(),
        totalAmount: 1000,
        vatAmount: 180,
        netAmount: 820,
        status: "APPROVED",
        sender: {
          name: "Test Supplier",
          taxNumber: "1234567890",
        },
      },
    ]
  }
}

