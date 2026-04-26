export function assertEInvoiceRuntimeReady() {
  const provider = (process.env.E_INVOICE_PROVIDER || "mock").toLowerCase()
  const allowMock = process.env.E_INVOICE_ALLOW_MOCK === "true"

  if (provider === "mock" && !allowMock) {
    throw new Error("E-Invoice provider is mock. Set E_INVOICE_ALLOW_MOCK=true only for non-production usage.")
  }

  if (provider !== "mock") {
    const missing = ["E_INVOICE_API_BASE_URL", "E_INVOICE_API_KEY"].filter(
      (key) => !process.env[key]
    )
    if (missing.length > 0) {
      throw new Error(`Missing e-invoice env vars: ${missing.join(", ")}`)
    }
  }
}
