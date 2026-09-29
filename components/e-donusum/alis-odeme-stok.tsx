"use client"

// ALIŞ FATURASI — ödeme durumu, ödeneceği tarih ve stok takibi.
//
// Paraşüt'ün "Fiş/Fatura Gideri" formundaki satır düzeni (solda etiket, sağda
// kontrol). Kurallar bileşende DEĞİL: ödeme `lib/personel/calisan-odemesi.ts` +
// `lib/invoice/create-invoice.ts`, stok `Invoice.skipStock` (POST ve PUT stok
// mutabakatı). Burası yalnız seçimi toplar ve ne olacağını söyler.

import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"
import { Bell, Boxes, CheckCircle2, HelpCircle, Landmark, UserRound } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAccounts } from "@/lib/swr/use-company-data"
import { accountTypeLabel } from "@/lib/finans/account-types"
import { withCompanyHref } from "@/lib/company/href"
import type { PurchasePaymentStatus } from "@/lib/personel/calisan-odemesi"
import { cn } from "@/lib/utils"

type Props = {
  companyId: string
  /** Düzenlemede ödeme seçimi yoktur: ödemeler faturanın Ödemeler ekranında. */
  mode: "create" | "edit"
  editingInvoiceId?: string | null
  currency: string

  status: PurchasePaymentStatus
  onStatusChange: (s: PurchasePaymentStatus) => void
  dueDate: string
  onDueDateChange: (v: string) => void
  /** Vadenin nereden geldiği (cari kartı / gelen fatura) — editördeki açıklama. */
  dueDateHint?: ReactNode
  accountId: string
  onAccountIdChange: (v: string) => void
  employeeId: string
  onEmployeeIdChange: (v: string) => void
  paymentDate: string
  onPaymentDateChange: (v: string) => void

  skipStock: boolean
  onSkipStockChange: (v: boolean) => void
  /** Stoğa işlenmiş irsaliye bağlandı: stoğun sahibi irsaliye, seçim anlamsız. */
  waybillOwnsStock: boolean
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-slate-200 py-4 first:border-t-0 md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-6 dark:border-border">
      <div className="flex items-center gap-3 pt-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-muted-foreground">
        <span className="text-slate-500 dark:text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const STATUS_OPTIONS: Array<{ value: PurchasePaymentStatus; label: string }> = [
  { value: "UNPAID", label: "Ödenecek" },
  { value: "PAID", label: "Ödendi" },
  { value: "EMPLOYEE", label: "Çalışan Cebinden Ödedi" },
]

export function AlisOdemeStok(props: Props) {
  const { companyId, mode, currency, status, onStatusChange } = props
  const { accounts } = useAccounts(companyId)
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }> | null>(null)
  const employeeAllowed = currency === "TRY"

  // Çalışan listesi yalnız seçenek açılınca çekilir; uç maaş/TC vermez, yalnız ad.
  useEffect(() => {
    if (status !== "EMPLOYEE" || employees !== null) return
    let cancelled = false
    fetch(`/api/faturalar/odemeler/calisanlar?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!cancelled) setEmployees(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setEmployees([])
      })
    return () => {
      cancelled = true
    }
  }, [status, employees, companyId])

  // "Ödendi" seçilince kasa önden seçili gelir (yoksa ilk hesap): boş bırakılırsa
  // sunucu da Kasa'ya yazar, ama kullanıcı nereye yazılacağını seçmeden görmeli.
  const { accountId, onAccountIdChange } = props
  useEffect(() => {
    if (mode !== "create" || status !== "PAID" || accountId || accounts.length === 0) return
    onAccountIdChange((accounts.find((a) => a.type === "CASH") ?? accounts[0]).id)
  }, [mode, status, accountId, accounts, onAccountIdChange])

  // Döviz seçilince çalışan seçeneği kapanır (defter TL tutulur); seçili kaldıysa geri al.
  useEffect(() => {
    if (!employeeAllowed && status === "EMPLOYEE") onStatusChange("UNPAID")
  }, [employeeAllowed, status, onStatusChange])

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 dark:border-border dark:bg-card">
      <Row icon={<HelpCircle className="h-4 w-4" />} label="Ödeme Durumu">
        {mode === "edit" ? (
          <p className="pt-2 text-sm text-muted-foreground">
            Ödemeler faturanın{" "}
            {props.editingInvoiceId ? (
              <Link
                href={withCompanyHref(`/faturalar/${props.editingInvoiceId}/odemeler`, companyId)}
                className="font-medium text-kobipo-navy underline underline-offset-2 dark:text-foreground"
              >
                Ödemeler ekranından
              </Link>
            ) : (
              "Ödemeler ekranından"
            )}{" "}
            girilir ve silinir (kasadan, bankadan ya da çalışan cebinden).
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Ödeme durumu"
              className="grid overflow-hidden rounded-md border border-slate-300 sm:grid-cols-3 dark:border-border"
            >
              {STATUS_OPTIONS.map((o, i) => {
                const disabled = o.value === "EMPLOYEE" && !employeeAllowed
                const active = props.status === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => props.onStatusChange(o.value)}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors",
                      i > 0 && "border-t border-slate-300 sm:border-l sm:border-t-0 dark:border-border",
                      active
                        ? "bg-kobipo-pale/60 font-semibold text-kobipo-navy dark:bg-primary/10 dark:text-foreground"
                        : "hover:bg-slate-50 dark:hover:bg-muted/40",
                      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                        active ? "border-kobipo-blue" : "border-slate-400",
                      )}
                    >
                      {active && <span className="h-2 w-2 rounded-full bg-kobipo-blue" />}
                    </span>
                    {o.label}
                  </button>
                )
              })}
            </div>
            {!employeeAllowed && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Döviz faturasında &quot;Çalışan Cebinden Ödedi&quot; seçilemez: çalışana borç TL tutulur.
              </p>
            )}
          </>
        )}
      </Row>

      {(mode === "edit" || props.status === "UNPAID") && (
        <Row icon={<Bell className="h-4 w-4" />} label="Ödeneceği Tarih">
          <Input
            type="date"
            value={props.dueDate}
            onChange={(e) => props.onDueDateChange(e.target.value)}
            aria-label="Ödeneceği tarih"
          />
          {props.dueDate ? (
            props.dueDateHint ? <div className="mt-1.5">{props.dueDateHint}</div> : null
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Bilinmiyor. Açık kalan tutar nakit projeksiyonunda vadesiz görünür.
            </p>
          )}
        </Row>
      )}

      {mode === "create" && props.status === "PAID" && (
        <Row icon={<Landmark className="h-4 w-4" />} label="Ödeme Hesabı">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={props.accountId || undefined} onValueChange={props.onAccountIdChange}>
              <SelectTrigger aria-label="Ödemenin çıktığı hesap">
                <SelectValue placeholder="Kasa / banka seçin" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({accountTypeLabel(a.type)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={props.paymentDate}
              onChange={(e) => props.onPaymentDateChange(e.target.value)}
              aria-label="Ödeme tarihi"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Faturanın tamamı kaydedilirken bu hesaptan ödenmiş yazılır.
            {!props.accountId && " Hesap seçilmezse Kasa'ya yazılır."}
          </p>
        </Row>
      )}

      {mode === "create" && props.status === "EMPLOYEE" && (
        <Row icon={<UserRound className="h-4 w-4" />} label="Ödeyen Çalışan">
          {employees !== null && employees.length === 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Kayıtlı çalışan yok. Önce Personel ekranından çalışan kartı açın.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={props.employeeId || undefined} onValueChange={props.onEmployeeIdChange}>
                <SelectTrigger aria-label="Ödeyen çalışan">
                  <SelectValue placeholder={employees === null ? "Yükleniyor…" : "Çalışan seçin"} />
                </SelectTrigger>
                <SelectContent>
                  {(employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={props.paymentDate}
                onChange={(e) => props.onPaymentDateChange(e.target.value)}
                aria-label="Ödeme tarihi"
              />
            </div>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            Kasadan para çıkmaz. Fatura kapanır, tutar çalışanın masraf hesabına firmanın borcu
            olarak yazılır. Geri ödeme personel kartındaki Masraflar sekmesinden yapılır.
          </p>
        </Row>
      )}

      <Row icon={<Boxes className="h-4 w-4" />} label="Stok Takibi">
        {props.waybillOwnsStock ? (
          <p className="pt-2 text-sm text-muted-foreground">
            Bağlanan irsaliye malı stoğa zaten işledi. Fatura stoğa ayrıca girmez.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Stok takibi" className="grid gap-3 sm:grid-cols-2">
            {[
              {
                skip: false,
                title: "Stok girişi yapılsın",
                body:
                  "Faturadaki ürünler kaydedince stoğa girer. Mal sonradan irsaliyeyle gelir ve irsaliye bu faturaya bağlanırsa giriş irsaliyeye geçer, çift sayılmaz.",
              },
              {
                skip: true,
                title: "Stok girişi yapılmasın",
                body:
                  "Fatura stoğa dokunmaz. Mal ayrıca irsaliyeyle girecekse ya da ürün stok takibi gerektirmiyorsa kullanın. Faturaya sonradan irsaliye bağlanabilir.",
              },
            ].map((o) => {
              const active = props.skipStock === o.skip
              return (
                <button
                  key={o.title}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => props.onSkipStockChange(o.skip)}
                  className={cn(
                    "flex gap-3 rounded-lg border p-3.5 text-left transition-colors",
                    active
                      ? "border-kobipo-blue bg-kobipo-pale/40 dark:border-primary dark:bg-primary/10"
                      : "border-slate-200 hover:bg-slate-50 dark:border-border dark:hover:bg-muted/40",
                  )}
                >
                  {active ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 fill-kobipo-navy text-white dark:fill-primary dark:text-background" />
                  ) : (
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-slate-400" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-bold uppercase tracking-wide text-slate-800 dark:text-foreground">
                      {o.title}
                    </span>
                    <span className="mt-1 block text-xs italic leading-relaxed text-muted-foreground">{o.body}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {mode === "edit" && !props.waybillOwnsStock && (
          <p className="mt-2 text-xs text-muted-foreground">
            Seçimi değiştirip kaydederseniz faturanın stok hareketi buna göre geri alınır ya da yazılır.
          </p>
        )}
      </Row>
    </div>
  )
}
