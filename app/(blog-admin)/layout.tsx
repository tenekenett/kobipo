import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { BlogAdminNav } from "@/components/blog-admin/nav"
import { Toaster } from "@/components/ui/toaster"

export const dynamic = "force-dynamic"

// Yönetim paneli arama motorlarınca indekslenmemeli.
export const metadata = { robots: { index: false, follow: false } }

export default async function BlogAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    redirect("/signin")
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { isSuperAdmin: true, isBlogEditor: true, name: true, email: true },
  })

  // Yalnız blog editörü veya süper admin erişebilir.
  if (!user || (!user.isBlogEditor && !user.isSuperAdmin)) {
    redirect("/")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlogAdminNav user={{ name: user.name, email: user.email }} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      <Toaster />
    </div>
  )
}
