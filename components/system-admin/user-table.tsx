"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Search, MoreVertical, Shield, Key, Edit, Trash2, Building2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import { Role } from "@prisma/client"

interface User {
  id: string
  name: string | null
  email: string
  isSuperAdmin: boolean
  createdAt: Date
  companies: {
    role: Role
    company: {
      id: string
      name: string
      isActive: boolean
    }
  }[]
}

interface UserTableProps {
  users: User[]
}

const roleLabels: Record<Role, string> = {
  ADMIN: "Yönetici",
  ACCOUNTANT: "Muhasebeci",
  STOCK: "Stokçu",
  SALES: "Satış",
  VIEWER: "Görüntüleyici",
}

const roleColors: Record<Role, string> = {
  ADMIN: "bg-purple-500/20 text-purple-400",
  ACCOUNTANT: "bg-blue-500/20 text-blue-400",
  STOCK: "bg-orange-500/20 text-orange-400",
  SALES: "bg-green-500/20 text-green-400",
  VIEWER: "bg-slate-500/20 text-slate-400",
}

export function UserTable({ users }: UserTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const { toast } = useToast()
  const router = useRouter()

  const filteredUsers = users.filter(user =>
    user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleResetPassword = async (userId: string) => {
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/reset-password`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Şifre sıfırlama maili gönderildi",
        })
      } else {
        throw new Error("İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Şifre sıfırlanırken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleToggleSuperAdmin = async (userId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/toggle-super-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSuperAdmin: !currentStatus })
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: `Kullanıcı ${currentStatus ? "normal kullanıcı" : "sistem yöneticisi"} yapıldı`,
        })
        router.refresh()
      } else {
        throw new Error("İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Kullanıcı yetkisi güncellenirken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          placeholder="İsim veya email ara..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">Kullanıcı</TableHead>
              <TableHead className="text-slate-400">Email</TableHead>
              <TableHead className="text-slate-400">Firmalar</TableHead>
              <TableHead className="text-slate-400">Yetki</TableHead>
              <TableHead className="text-slate-400">Kayıt Tarihi</TableHead>
              <TableHead className="text-slate-400 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                  {searchTerm ? "Arama sonucu bulunamadı" : "Henüz kullanıcı kaydı yok"}
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
                        user.isSuperAdmin 
                          ? "bg-gradient-to-br from-red-500 to-orange-500 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}>
                        {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{user.name || "İsimsiz"}</p>
                        {user.isSuperAdmin && (
                          <span className="text-xs text-red-400 flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            Sistem Yöneticisi
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    {user.companies.length === 0 ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      <div className="space-y-1">
                        {user.companies.slice(0, 2).map((uc) => (
                          <div key={uc.company.id} className="flex items-center gap-2">
                            <Building2 className="h-3 w-3 text-slate-500" />
                            <span className="text-sm text-slate-300">{uc.company.name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${roleColors[uc.role]}`}>
                              {roleLabels[uc.role]}
                            </span>
                          </div>
                        ))}
                        {user.companies.length > 2 && (
                          <span className="text-xs text-slate-500">
                            +{user.companies.length - 2} firma daha
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.isSuperAdmin ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                        Super Admin
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-500/20 text-slate-400">
                        Kullanıcı
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {new Date(user.createdAt).toLocaleDateString("tr-TR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
                        <DropdownMenuLabel className="text-slate-400">İşlemler</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuItem className="text-slate-300 focus:bg-slate-800 focus:text-white">
                          <Edit className="h-4 w-4 mr-2" />
                          Düzenle
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => handleResetPassword(user.id)}
                        >
                          <Key className="h-4 w-4 mr-2" />
                          Şifre Sıfırla
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => handleToggleSuperAdmin(user.id, user.isSuperAdmin)}
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          {user.isSuperAdmin ? "Super Admin Kaldır" : "Super Admin Yap"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-400">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination info */}
      <div className="text-sm text-slate-500">
        Toplam {filteredUsers.length} kullanıcı gösteriliyor
      </div>
    </div>
  )
}

