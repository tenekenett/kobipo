import Link from "next/link"
import { Building2, FileText, Package, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAdminStats } from "@/lib/dashboard/admin-queries"
import { withCompanyHref } from "@/lib/company/href"

interface DashboardStatsProps {
  companyId: string
}

export async function DashboardStats({ companyId }: DashboardStatsProps) {
  const stats = await getAdminStats(companyId)

  // Linkler AKTİF seçime değil, rakamların ait olduğu firmaya bağlanır. Bu bileşen şube
  // detay sayfasında da kullanılıyor: orada aktif seçim ANA firmadır ama ekrandaki
  // rakamlar ŞUBEye aittir. Param'sız link, kullanıcıyı şubenin rakamına tıklayıp ana
  // firmanın listesine düşürüyordu.
  const href = (path: string) => withCompanyHref(path, companyId)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
          <Users className="h-5 w-5 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.customerCount}</div>
          <Link href={href("/cari")} className="text-xs text-blue-500 hover:underline">
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
          <Link href={href("/cari")} className="text-xs text-purple-500 hover:underline">
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
          <Link href={href("/stok")} className="text-xs text-orange-500 hover:underline">
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
          <Link href={href("/e-donusum")} className="text-xs text-green-500 hover:underline">
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
