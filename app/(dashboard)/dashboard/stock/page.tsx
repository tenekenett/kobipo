import { redirect } from "next/navigation"
import { getAuthContext } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Package, AlertTriangle, TrendingUp, TrendingDown, ArrowUpDown, BarChart3 } from "lucide-react"
import { Role } from "@prisma/client"

export const dynamic = "force-dynamic"

export default async function StockDashboard() {
  const authContext = await getAuthContext()

  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }

  // Stokçu veya Admin yetkisi kontrolü
  const allowedRoles: Role[] = [Role.STOCK, Role.ADMIN]
  if (!allowedRoles.includes(authContext.activeCompany.role)) {
    redirect("/")
  }

  const companyId = authContext.activeCompany.companyId

  // Dashboard verileri
  const [
    totalProducts,
    activeProducts,
    lowStockProducts,
    recentMovements,
    topMovingProducts,
  ] = await Promise.all([
    prisma.product.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId, isActive: true } }),
    prisma.product.findMany({
      where: { 
        companyId, 
        isActive: true,
        stockQuantity: { lt: 10 },
        isService: false
      },
      orderBy: { stockQuantity: "asc" },
      take: 5
    }),
    prisma.stockMovement.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { product: true }
    }),
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { companyId },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5
    })
  ])

  // Top moving products'ın detaylarını al
  const topProductIds = topMovingProducts.map(p => p.productId)
  const topProducts = await prisma.product.findMany({
    where: { id: { in: topProductIds } }
  })

  // Stok değeri hesapla
  const stockValue = await prisma.product.aggregate({
    where: { companyId, isService: false },
    _sum: { stockQuantity: true }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Package className="h-8 w-8 text-orange-500" />
            Stok Paneli
          </h1>
          <p className="text-muted-foreground mt-1">
            Stok durumu ve hareketler
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      {/* Ana İstatistikler */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Ürün</CardTitle>
            <Package className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalProducts}</div>
            <Link href="/stok" className="text-xs text-orange-500 hover:underline">
              Tümünü gör →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktif Ürün</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeProducts}</div>
            <span className="text-xs text-muted-foreground">Satışta olan ürünler</span>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kritik Stok</CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{lowStockProducts.length}</div>
            <span className="text-xs text-muted-foreground">10&apos;un altında</span>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Stok</CardTitle>
            <BarChart3 className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{Number(stockValue._sum.stockQuantity || 0).toLocaleString('tr-TR')}</div>
            <span className="text-xs text-muted-foreground">Adet</span>
          </CardContent>
        </Card>
      </div>

      {/* Kritik Stok Uyarıları */}
      {lowStockProducts.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Kritik Stok Uyarıları
            </CardTitle>
            <CardDescription className="text-red-600 dark:text-red-400">
              Bu ürünlerin stok miktarı kritik seviyenin altında
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {lowStockProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-800">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{product.code || 'Kodsuz'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-600">{Number(product.stockQuantity)}</p>
                    <p className="text-xs text-muted-foreground">{product.unit}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Son Hareketler ve En Çok Hareket */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5 text-blue-500" />
                Son Stok Hareketleri
              </span>
              <Link href="/stok" className="text-sm text-blue-500 hover:underline font-normal">
                Tümü →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentMovements.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Henüz stok hareketi yok
              </div>
            ) : (
              <div className="space-y-2">
                {recentMovements.map((movement) => (
                  <div key={movement.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        movement.type === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                      }`}>
                        {movement.type === 'IN' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{movement.product?.name}</p>
                        <p className="text-xs text-muted-foreground">{movement.description || movement.type}</p>
                      </div>
                    </div>
                    <span className={`font-medium ${movement.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                      {movement.type === 'IN' ? '+' : '-'}{Number(movement.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hızlı İşlemler</CardTitle>
            <CardDescription>Stok işlemleri</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <Package className="w-8 h-8 text-orange-500" />
                <div>
                  <p className="font-medium text-sm">Yeni Ürün</p>
                  <p className="text-xs text-muted-foreground">Ürün ekle</p>
                </div>
              </Link>

              <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <TrendingUp className="w-8 h-8 text-green-500" />
                <div>
                  <p className="font-medium text-sm">Stok Girişi</p>
                  <p className="text-xs text-muted-foreground">Stok ekle</p>
                </div>
              </Link>

              <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <TrendingDown className="w-8 h-8 text-red-500" />
                <div>
                  <p className="font-medium text-sm">Stok Çıkışı</p>
                  <p className="text-xs text-muted-foreground">Stok düş</p>
                </div>
              </Link>

              <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <BarChart3 className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Stok Raporu</p>
                  <p className="text-xs text-muted-foreground">Rapor görüntüle</p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

