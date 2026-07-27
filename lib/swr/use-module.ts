"use client"

// Seçili firmada bir modülün AÇIK olup olmadığını söyler.
//
// Bu yalnızca ARAYÜZ uyarlaması içindir — yetki kontrolü değil. Etiketleri,
// varsayılan filtreleri ve yardım metinlerini modüle göre değiştirmek için
// kullanılır (ör. Restoran & Kafe açıkken "Satışta göster" kutusu "Menüde
// göster" olur). Gerçek erişim kısıtı için nav gizleme + ModuleGuard var;
// sunucu tarafı kapı henüz yok (bkz. docs/restoran/SADELESTIRME.md "Kapsam dışı").

import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

/**
 * Firma henüz çözülmemişse `true` döner: modül kapalı sanıp arayüzü yanlış
 * kurmaktansa varsayılan (açık) davranışı göstermek daha güvenli — ModuleGuard
 * da aynı gerekçeyle firma çözülene kadar engellemiyor.
 */
export function useModuleEnabled(moduleKey: string): boolean {
  const { selectedCompany } = useDashboardCompany()
  if (!selectedCompany) return true
  return !(selectedCompany.disabledModules ?? []).includes(moduleKey)
}
