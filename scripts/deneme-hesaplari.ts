/**
 * DENEME HESAPLARI — abonelik akışını elle sınamak için izole bir firma ağacı ve kullanıcılar.
 *
 *   npx tsx scripts/deneme-hesaplari.ts          → oluştur (idempotent, tekrar çalıştırılabilir)
 *   npx tsx scripts/deneme-hesaplari.ts --sil    → oluşturduğu HER ŞEYİ siler
 *
 * NEDEN: firma bazlı abonelikte tek bir senaryo canlıda hiçbir hesapla sınanamıyordu —
 * "şubede ADMIN ama hesap kökünde DEĞİL". Canlıdaki iki şube ADMIN'i aynı zamanda kökün
 * de ADMIN'i olduğu için ödeme düğmesi ikisinde de haklı olarak açık geliyor; kapalı hâli
 * hiç görülemiyordu.
 *
 * Kurulan ağaç:
 *
 *   zz-deneme-ana   (kök)   ACTIVE abonelik · restaurant satın alınmış · kota 3 şube / 1 firma
 *     └ zz-deneme-sube (şube)  ABONELİĞİ YOK → ücretli modüller kilitli doğar
 *
 * Kullanıcılar (hepsi @kobipo.test — gerçek posta kutusu değil, e-posta gitmez):
 *
 *   zz-hesap-yoneticisi@kobipo.test  ana=ADMIN            → her iki ekranda da ÖDEYEBİLİR
 *   zz-sube-admini@kobipo.test       şube=ADMIN (ana yok) → şube ekranında düğme KAPALI,
 *                                                            "hesap yöneticisi satın alır"
 *   zz-sube-muduru@kobipo.test       şube=BRANCH_MANAGER  → abonelik sayfasını HİÇ göremez
 *                                                            (ACCOUNT_ADMIN_PAGES)
 *
 * Şifre hepsinde aynı: deneme1234
 *
 * Veriler `zz-deneme-` önekiyle işaretli; işi bitince `--sil` ile tek komutta kalkar.
 * Gerçek firmalara DOKUNMAZ — silme yalnız bu önekli kayıtları ve @kobipo.test
 * kullanıcılarını hedefler.
 */
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { defaultDisabledModules } from "@/lib/modules"
import { periodEndFor } from "@/lib/billing/period"

const SIL = process.argv.includes("--sil")
const SIFRE = "deneme1234"

const ANA_SLUG = "zz-deneme-ana"
const SUBE_SLUG = "zz-deneme-sube"
const KULLANICILAR = [
  { email: "zz-hesap-yoneticisi@kobipo.test", name: "ZZ Hesap Yöneticisi" },
  { email: "zz-sube-admini@kobipo.test", name: "ZZ Şube Admini" },
  { email: "zz-sube-muduru@kobipo.test", name: "ZZ Şube Müdürü" },
] as const

async function sil() {
  const companies = await prisma.company.findMany({
    where: { slug: { in: [ANA_SLUG, SUBE_SLUG] } },
    select: { id: true, slug: true },
  })
  const ids = companies.map((c) => c.id)
  const users = await prisma.user.findMany({
    where: { email: { in: KULLANICILAR.map((u) => u.email) } },
    select: { id: true, email: true },
  })

  if (ids.length === 0 && users.length === 0) {
    console.log("Silinecek deneme kaydı yok.")
    return
  }

  // Sıra önemli: bağlı satırlar önce. Şube, kökten önce silinir (parentCompanyId FK).
  await prisma.subscription.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.packageOrder.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.userCompany.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.warehouse.deleteMany({ where: { companyId: { in: ids } } })
  for (const slug of [SUBE_SLUG, ANA_SLUG]) {
    await prisma.company.deleteMany({ where: { slug } })
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } })

  console.log(`Silindi: ${companies.length} firma (${companies.map((c) => c.slug).join(", ")}), ${users.length} kullanıcı`)
}

async function olustur() {
  const free = await getFreeModuleKeys()
  const kilitli = defaultDisabledModules(free)
  const hash = await bcrypt.hash(SIFRE, 10)

  // 1) KÖK FİRMA — kendi aboneliği ve kotası var.
  let ana = await prisma.company.findUnique({ where: { slug: ANA_SLUG } })
  if (!ana) {
    ana = await prisma.company.create({
      data: {
        slug: ANA_SLUG,
        name: "ZZ Deneme Ana Firma",
        city: "İstanbul",
        taxNumber: "1111111114",
        taxOffice: "Deneme VD",
        address: "Deneme Mah. Deneme Sok. No:1",
        email: "zz-deneme@kobipo.test",
        // Kökte ücretli modül satın alınmış sayılıyor; aşağıdaki abonelik onu taşıyor.
        disabledModules: [],
        suppressedModules: [],
        onboardingCompletedAt: new Date(),
      },
    })
    await prisma.warehouse.create({
      data: { companyId: ana.id, code: "ANA", name: "Ana Depo", isDefault: true },
    })
  }

  // 2) ŞUBE — aboneliği YOK, ücretli modüller kilitli doğar (yetki devretmez kuralı).
  let sube = await prisma.company.findUnique({ where: { slug: SUBE_SLUG } })
  if (!sube) {
    sube = await prisma.company.create({
      data: {
        slug: SUBE_SLUG,
        name: "ZZ Deneme Ana Firma",
        branchName: "Deneme Şubesi",
        city: "Ankara",
        // Şube kimliği ana firmadan devralınır (aynı tüzel kişi).
        taxNumber: ana.taxNumber,
        taxOffice: ana.taxOffice,
        parentCompanyId: ana.id,
        accountRootId: ana.id,
        disabledModules: kilitli,
        suppressedModules: [],
        onboardingCompletedAt: new Date(),
      },
    })
    await prisma.warehouse.create({
      data: { companyId: sube.id, code: "ANA", name: "Ana Depo", isDefault: true },
    })
  }

  // 3) KULLANICILAR
  const users: Record<string, string> = {}
  for (const u of KULLANICILAR) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { password: hash, name: u.name },
      create: { email: u.email, name: u.name, password: hash },
      select: { id: true },
    })
    users[u.email] = row.id
  }

  // 4) ÜYELİKLER — asıl sınav burada: şube admini KÖKTE ÜYE DEĞİL.
  const uyelik = async (email: string, companyId: string, role: "ADMIN" | "BRANCH_MANAGER") => {
    const varOlan = await prisma.userCompany.findFirst({
      where: { userId: users[email], companyId },
      select: { id: true },
    })
    if (varOlan) {
      await prisma.userCompany.update({ where: { id: varOlan.id }, data: { role } })
      return
    }
    await prisma.userCompany.create({ data: { userId: users[email], companyId, role } })
  }
  await uyelik("zz-hesap-yoneticisi@kobipo.test", ana.id, "ADMIN")
  await uyelik("zz-sube-admini@kobipo.test", sube.id, "ADMIN")
  await uyelik("zz-sube-muduru@kobipo.test", sube.id, "BRANCH_MANAGER")

  // 5) KÖKÜN ABONELİĞİ — ücretli modül + kota. Şubeye HİÇBİR ŞEY yazılmaz.
  const mevcut = await prisma.subscription.findFirst({ where: { companyId: ana.id } })
  if (!mevcut) {
    const start = new Date()
    await prisma.subscription.create({
      data: {
        userId: users["zz-hesap-yoneticisi@kobipo.test"],
        companyId: ana.id,
        provider: "NONE",
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        purchasedModules: ["restaurant"],
        branchQuota: 3,
        companyQuota: 1,
        amount: null,
        autoRenew: false,
        periodStart: start,
        periodEnd: periodEndFor("YEARLY", start),
      },
    })
  }

  console.log("Kurulan ağaç:")
  console.log(`  kök  : ${ANA_SLUG}   (ACTIVE abonelik · restaurant · kota 3 şube / 1 firma)`)
  console.log(`  şube : ${SUBE_SLUG}  (abonelik YOK → ücretli modüller kilitli)`)
  console.log("")
  console.log(`Şifre (hepsi): ${SIFRE}`)
  for (const u of KULLANICILAR) console.log(`  ${u.email}`)
  console.log("")
  console.log("Beklenenler:")
  console.log(`  hesap-yoneticisi → /ayarlar/abonelik?company=${SUBE_SLUG} : düğme AÇIK`)
  console.log(`  sube-admini      → /ayarlar/abonelik?company=${SUBE_SLUG} : düğme KAPALI + uyarı`)
  console.log(`  sube-muduru      → /ayarlar/abonelik?company=${SUBE_SLUG} : sayfa hiç açılmaz`)
  console.log("")
  console.log("Bitince: npx tsx scripts/deneme-hesaplari.ts --sil")
}

;(SIL ? sil() : olustur())
  .catch((e) => {
    console.error("HATA:", e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
