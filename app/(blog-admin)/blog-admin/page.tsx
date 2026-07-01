"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Pencil, Trash2, ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/use-toast"

interface BlogPostRow {
  id: string
  slug: string
  title: string
  category: string
  status: "DRAFT" | "PUBLISHED"
  publishedAt: string | null
  updatedAt: string
}

export default function BlogAdminListPage() {
  const { toast } = useToast()
  const [posts, setPosts] = useState<BlogPostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<BlogPostRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/blog")
      if (!res.ok) throw new Error("Liste alınamadı")
      setPosts(await res.json())
    } catch (e: unknown) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Yazılar yüklenemedi",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/blog/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Silinemedi")
      toast({ title: "Silindi", description: deleteTarget.title })
      setDeleteTarget(null)
      load()
    } catch (e: unknown) {
      toast({
        title: "Silinemedi",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Blog yazıları</h1>
          <p className="text-sm text-muted-foreground">Yazıları oluştur, düzenle ve yayınla.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor...
            </div>
          ) : posts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              Henüz yazı yok.{" "}
              <Link href="/blog-admin/yeni" className="font-medium text-kobipo-blue hover:underline">
                İlk yazını oluştur
              </Link>
              .
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Başlık</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Güncelleme</TableHead>
                  <TableHead className="text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="font-medium text-foreground">{post.title}</TableCell>
                    <TableCell className="text-muted-foreground">{post.category}</TableCell>
                    <TableCell>
                      {post.status === "PUBLISHED" ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                          Yayında
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Taslak
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(post.updatedAt).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {post.status === "PUBLISHED" && (
                          <Button variant="ghost" size="sm" asChild title="Sitede aç">
                            <a href={`/kurumsal/blog/${post.slug}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" asChild title="Düzenle">
                          <Link href={`/blog-admin/${post.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Sil"
                          onClick={() => setDeleteTarget(post)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Yazıyı sil"
        description={`"${deleteTarget?.title}" yazısı kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        variant="destructive"
        isProcessing={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
