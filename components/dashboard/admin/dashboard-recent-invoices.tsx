import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getRecentInvoices } from "@/lib/dashboard/admin-queries"

interface DashboardRecentInvoicesProps {
  companyId: string
}

export async function DashboardRecentInvoices({ companyId }: DashboardRecentInvoicesProps) {
  const recentInvoices = await getRecentInvoices(companyId, 5)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Son Faturalar</span>
          <Link href="/e-donusum" className="text-sm text-blue-500 hover:underline font-normal">
            Tümü →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentInvoices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Henüz fatura yok</div>
        ) : (
          <div className="space-y-3">
            {recentInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div>
                  <p className="font-medium">{invoice.invoiceNo}</p>
                  <p className="text-sm text-muted-foreground">
                    {invoice.customer?.name || invoice.supplier?.name || "-"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">
                    ₺{Number(invoice.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </p>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      invoice.status === "DRAFT"
                        ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300"
                        : invoice.status === "SENT"
                        ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                    }`}
                  >
                    {invoice.status === "DRAFT"
                      ? "Taslak"
                      : invoice.status === "SENT"
                      ? "Gönderildi"
                      : "İptal"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
