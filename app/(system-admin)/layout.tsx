import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { SystemAdminNav } from "@/components/system-admin/nav"
import { Toaster } from "@/components/ui/toaster"

export const dynamic = "force-dynamic"

export default async function SystemAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  // Oturum yoksa giriş sayfasına yönlendir
  if (!session?.user?.email) {
    redirect("/system-admin/signin")
  }

  // Super admin kontrolü
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { isSuperAdmin: true, name: true, email: true }
  })

  if (!user?.isSuperAdmin) {
    redirect("/") // Yetkisiz kullanıcıları ana sayfaya yönlendir
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <SystemAdminNav user={{ name: user.name, email: user.email }} />
      <main className="lg:pl-72">
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
      <Toaster />
    </div>
  )
}

