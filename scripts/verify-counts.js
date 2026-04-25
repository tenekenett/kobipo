const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, isEDonusumEnabled: true },
  })
  console.log("Companies:", companies)
  for (const c of companies) {
    const [customers, suppliers, invoices, warehouses] = await Promise.all([
      prisma.customer.count({ where: { companyId: c.id } }),
      prisma.supplier.count({ where: { companyId: c.id } }),
      prisma.invoice.count({ where: { companyId: c.id } }),
      prisma.warehouse.count({ where: { companyId: c.id } }),
    ])
    console.log(`- ${c.name} (${c.id}) -> customers:${customers} suppliers:${suppliers} invoices:${invoices} warehouses:${warehouses}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
