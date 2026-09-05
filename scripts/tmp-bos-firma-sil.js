/**
 * TEK KULLANIMLIK temizlik: Reypo Medya Ajansı hesabına bağlı iki BOŞ test ek firmasını
 * siler ("asdasdsa", "dsad"). Çalıştırdıktan sonra bu dosyayı silin.
 *
 * Silmeden önce firma satırı + üyelik + abonelik + depo kayıtları JSON olarak yedeklenir.
 * İlişkili diğer veriler şema seviyesinde onDelete: Cascade ile birlikte gider
 * (bkz. app/api/system-admin/companies/[id]/route.ts → DELETE).
 *
 *   node scripts/tmp-bos-firma-sil.js
 */
require("dotenv").config()
const fs = require("fs")
const path = require("path")
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const IDS = ["cmsud3h0w0005n1914pbc2ldu", "cmsufhrir0004fiijmwek7lbe"]
const ACCOUNT_ROOT = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı
const OUT = path.join(process.cwd(), "silinen-firmalar-yedek.json")

async function main() {
  // 1) Yedek — geri dönülemez işlem
  const backup = {}
  for (const id of IDS) {
    backup[id] = {
      company: await prisma.company.findUnique({ where: { id } }),
      userCompany: await prisma.userCompany.findMany({ where: { companyId: id } }),
      subscription: await prisma.subscription.findMany({ where: { companyId: id } }),
      warehouse: await prisma.warehouse.findMany({ where: { companyId: id } }),
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(backup, null, 2))
  console.log("Yedek yazıldı:", OUT)

  // 2) Güvenlik kontrolü: yalnızca BOŞ ve bu hesaba bağlı kayıtlar silinsin
  for (const id of IDS) {
    const c = backup[id].company
    if (!c) continue
    if (c.accountRootId !== ACCOUNT_ROOT) {
      throw new Error(`${id} beklenen hesaba bağlı değil (accountRootId=${c.accountRootId}) — iptal`)
    }
    const kids = await prisma.company.count({
      where: { OR: [{ parentCompanyId: id }, { accountRootId: id }] },
    })
    const [invoices, customers, products, orders] = await Promise.all([
      prisma.invoice.count({ where: { companyId: id } }),
      prisma.customer.count({ where: { companyId: id } }),
      prisma.product.count({ where: { companyId: id } }),
      prisma.packageOrder.count({ where: { companyId: id } }),
    ])
    if (kids || invoices || customers || products || orders) {
      throw new Error(
        `${id} (${c.name}) boş değil — şube:${kids} fatura:${invoices} cari:${customers} ürün:${products} sipariş:${orders} — iptal`
      )
    }
  }

  // 3) Sil
  for (const id of IDS) {
    const c = backup[id].company
    if (!c) {
      console.log(id, "→ zaten yok")
      continue
    }
    await prisma.company.delete({ where: { id } })
    await prisma.systemLog.create({
      data: {
        userId: null,
        action: "DELETE_COMPANY",
        entity: "Company",
        entityId: id,
        details: `Firma "${c.name}" ve tüm verileri silindi (bakım betiği: boş test kaydı temizliği)`,
        level: "WARN",
      },
    })
    console.log("Silindi:", id, c.name)
  }

  // 4) Doğrula
  const left = await prisma.company.findMany({
    where: {
      OR: [{ id: { in: IDS } }, { accountRootId: ACCOUNT_ROOT }, { parentCompanyId: ACCOUNT_ROOT }],
    },
    select: { id: true, name: true },
  })
  console.log(
    "Kalan (hedefler + Reypo Medya hesabının birimleri):",
    left.length ? JSON.stringify(left) : "yok"
  )
}

main()
  .catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
