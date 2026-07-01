"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"
import { Newspaper, LogOut, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface BlogAdminNavProps {
  user: {
    name: string | null
    email: string | null
  }
}

export function BlogAdminNav({ user }: BlogAdminNavProps) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/blog-admin" className="flex items-center gap-2 font-semibold text-foreground">
          <Newspaper className="h-5 w-5 text-kobipo-blue" />
          Blog Yönetimi
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/blog-admin/yeni">
              <Plus className="mr-1.5 h-4 w-4" />
              Yeni yazı
            </Link>
          </Button>
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            <div className="font-medium text-foreground">{user.name || "Blog editörü"}</div>
            <div>{user.email}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/signin" })}
            title="Çıkış yap"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
