import Link from "next/link"
import { FileText, Package, TrendingUp, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function DashboardQuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hızlı İşlemler</CardTitle>
        <CardDescription>Yönetici işlemleri</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/cari"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Yeni Müşteri</p>
              <p className="text-xs text-muted-foreground">Müşteri ekle</p>
            </div>
          </Link>

          <Link
            href="/e-donusum"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Yeni Fatura</p>
              <p className="text-xs text-muted-foreground">Fatura oluştur</p>
            </div>
          </Link>

          <Link
            href="/stok"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Package className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Yeni Ürün</p>
              <p className="text-xs text-muted-foreground">Ürün ekle</p>
            </div>
          </Link>

          <Link
            href="/raporlar"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Raporlar</p>
              <p className="text-xs text-muted-foreground">Analiz görüntüle</p>
            </div>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
