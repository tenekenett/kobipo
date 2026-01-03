export interface EInvoiceProvider {
  name: string
  sendInvoice(invoice: InvoiceData): Promise<EInvoiceResponse>
  getInvoiceStatus(uuid: string): Promise<EInvoiceStatus>
  getIncomingInvoices(params: IncomingInvoiceParams): Promise<IncomingInvoice[]>
}

export interface InvoiceData {
  invoiceNo: string
  date: Date
  dueDate?: Date
  customer?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    country?: string
  }
  supplier?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    country?: string
  }
  items: InvoiceItemData[]
  notes?: string
}

export interface InvoiceItemData {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  productId?: string
}

export interface EInvoiceResponse {
  success: boolean
  uuid?: string
  error?: string
  message?: string
}

export interface EInvoiceStatus {
  status: "SENT" | "APPROVED" | "REJECTED" | "CANCELLED" | "PENDING"
  uuid: string
  message?: string
}

export interface IncomingInvoiceParams {
  startDate?: Date
  endDate?: Date
  status?: string
}

export interface IncomingInvoice {
  uuid: string
  invoiceNo: string
  date: Date
  totalAmount: number
  vatAmount: number
  netAmount: number
  status: string
  sender: {
    name: string
    taxNumber: string
  }
}

