import Link from "next/link"
import { Building2, FileText, Package, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAdminStats } from "@/lib/dashboard/admin-queries"

interface DashboardStatsProps {
  companyId: string
}

export async function DashboardStats({ companyId }: DashboardStatsProps) {
  const stats = await getAdminStats(companyId)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
          <Users className="h-5 w-5 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.customerCount}</div>
          <Link href="/cari" className="text-xs text-blue-500 hover:underline">
            Yönet →
          </Link>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Tedarikçiler</CardTitle>
          <Building2 className="h-5 w-5 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.supplierCount}</div>
          <Link href="/cari" className="text-xs text-purple-500 hover:underline">
            Yönet →
          </Link>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Ürünler</CardTitle>
          <Package className="h-5 w-5 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.productCount}</div>
          <Link href="/stok" className="text-xs text-orange-500 hover:underline">
            Yönet →
          </Link>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Faturalar</CardTitle>
          <FileText className="h-5 w-5 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.invoiceCount}</div>
          <Link href="/e-donusum" className="text-xs text-green-500 hover:underline">
            Yönet →
          </Link>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Kullanıcılar</CardTitle>
          <Users className="h-5 w-5 text-pink-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.userCount}</div>
          <span className="text-xs text-muted-foreground">Firma kullanıcıları</span>
        </CardContent>
      </Card>
    </div>
  )
}
