import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertCariVisible } from "@/lib/cari/visibility"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { assertCariMirrorWrite } from "@/lib/cari/dual-role-access"
import { withApiErrors } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"

export const dynamic = "force-dynamic"

const PARTY_SELECT = { id: true, name: true, authorizedUserId: true, archivedAt: true } as const

/**
 * Virman fişini İKİ BACAĞIYLA BİRLİKTE siler (bacaklar başlığa cascade bağlı).
 *
 * Kasa virmanındaki "silinemez" kuralı burada BİLEREK yok: düzenleme olmadığı
 * için yanlış fişin tek düzeltme yolu silip yeniden girmektir. Yalnız tek bacağı
 * silmek mümkün değildir — karşı tarafın bakiyesi karşılıksız kalırdı.
 *
 * Kullanıcı fişin DOKUNDUĞU her cariyi görebilmeli ve o cari sayfasına
 * yazabilmelidir: görmediği bir carinin bakiyesini değiştiremez. Arşivdeki
 * cari bakiyesi sıfır olduğu için arşivlenmiştir; virmanı silmek onu açık
 * bakiyeli bir arşiv kaydına çevirirdi.
 */
export const DELETE = withApiErrors(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const virman = await prisma.cariVirman.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      virmanNo: true,
      legs: {
        select: {
          customer: { select: PARTY_SELECT },
          supplier: { select: PARTY_SELECT },
        },
      },
    },
  })
  if (!virman) {
    return NextResponse.json({ error: "Virman fişi bulunamadı" }, { status: 404 })
  }

  const access = await ensureCompanyWrite(virman.companyId)
  const visibility = await resolveCariVisibility(virman.companyId)

  for (const leg of virman.legs) {
    const party = leg.customer ?? leg.supplier
    if (!party) continue
    assertCariVisible(party, visibility)
    await assertCariMirrorWrite(access, leg.customer ? "customer" : "supplier")
    if (party.archivedAt) {
      return NextResponse.json(
        {
          error: `"${party.name}" arşivlenmiş. Virmanı silmek için önce cariyi arşivden çıkarın.`,
        },
        { status: 409 },
      )
    }
  }

  await prisma.cariVirman.delete({ where: { id: virman.id } })

  revalidateDashboard(virman.companyId)

  return NextResponse.json({ success: true, virmanNo: virman.virmanNo })
})
