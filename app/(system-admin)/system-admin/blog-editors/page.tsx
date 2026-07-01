import { prisma } from "@/lib/db/prisma"
import { BlogEditorsManager } from "@/components/system-admin/blog-editors-manager"

export const dynamic = "force-dynamic"

export default async function BlogEditorsPage() {
  const editors = await prisma.user.findMany({
    where: { isBlogEditor: true },
    select: { id: true, name: true, email: true, isSuperAdmin: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  const initial = editors.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    isSuperAdmin: e.isSuperAdmin,
    createdAt: e.createdAt.toISOString(),
  }))

  return <BlogEditorsManager initialEditors={initial} />
}
