// GEÇİCİ teşhis (read-only, sonra silinir). login_attempts tablosundaki son satırları gösterir.
const path = require("path")
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") })
require("dotenv").config({ path: path.join(process.cwd(), ".env") })
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
;(async () => {
  const rows = await prisma.loginAttempt.findMany({ orderBy: { updatedAt: "desc" }, take: 20 })
  console.log("login_attempts satır sayısı:", rows.length)
  const now = Date.now()
  for (const r of rows) {
    const ageSec = Math.round((now - new Date(r.updatedAt).getTime()) / 1000)
    console.log(`ip=${r.ip} failed=${r.failedCount} lockedUntil=${r.lockedUntil ? new Date(r.lockedUntil).toISOString() : "-"} lastEmail=${r.lastEmail || "-"} (${ageSec}s önce)`)
  }
  if (rows.length === 0) console.log(">>> HİÇ satır yok → çalışan sunucu başarısız denemeleri KAYDETMİYOR (muhtemelen eski kod / restart gerek).")
  await prisma.$disconnect()
})()
