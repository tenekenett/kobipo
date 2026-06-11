"use client"

import { AlertTriangle, Archive, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface CariDeletability {
  canDelete: boolean
  canArchive: boolean
  deleteBlockReasons: string[]
  archiveBlockReasons: string[]
}

interface CariArchiveDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hangi buton tıklandı: arşivle mi, sil mi. */
  mode: "archive" | "delete"
  /** "Müşteri" | "Tedarikçi" */
  entityLabel: string
  deletability: CariDeletability | null
  isProcessing: boolean
  onConfirmArchive: () => void
  onConfirmDelete: () => void
}

function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
      {reasons.map((reason) => (
        <li key={reason} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{reason}</span>
        </li>
      ))}
    </ul>
  )
}

function ArchiveConsequences({ entityLabel }: { entityLabel: string }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Arşivleme işleminin sonucunda:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>Kayıt artık {entityLabel} listelerinde görünmeyecek.</li>
        <li>{entityLabel}'ye düzenlenen faturalar etkilenmeyecek.</li>
      </ul>
    </div>
  )
}

export function CariArchiveDeleteDialog({
  open,
  onOpenChange,
  mode,
  entityLabel,
  deletability,
  isProcessing,
  onConfirmArchive,
  onConfirmDelete,
}: CariArchiveDeleteDialogProps) {
  if (!deletability) return null

  const lower = entityLabel.toLocaleLowerCase("tr-TR")
  const { canDelete, canArchive, deleteBlockReasons, archiveBlockReasons } = deletability

  // Gösterilecek senaryoyu belirle.
  type Scenario =
    | "confirmArchive"
    | "confirmDelete"
    | "deleteOfferArchive"
    | "blocked"
  let scenario: Scenario
  if (mode === "archive") {
    scenario = canArchive ? "confirmArchive" : "blocked"
  } else {
    scenario = canDelete
      ? "confirmDelete"
      : canArchive
        ? "deleteOfferArchive"
        : "blocked"
  }

  const content = {
    confirmArchive: {
      title: "Arşivleme işlemini onaylayın",
      description: `Bu ${lower} kaydını arşivlemek istediğinize emin misiniz?`,
      reasons: [] as string[],
      showConsequences: true,
      primary: "archive" as const,
    },
    confirmDelete: {
      title: "Silme işlemini onaylayın",
      description: `Bu ${lower} kaydını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
      reasons: [] as string[],
      showConsequences: false,
      primary: "delete" as const,
    },
    deleteOfferArchive: {
      title: "Kayıt silinemiyor, arşivlemek ister misiniz?",
      description: `Bu ${lower} kaydı aşağıdaki sebep(ler)den ötürü silinemiyor. Silinemeyen kayıtları arşivleyerek kullanımdan kaldırabilir, arşivlenmiş kayıtlara ileride referans amaçlı erişebilirsiniz.`,
      reasons: deleteBlockReasons,
      showConsequences: true,
      primary: "archive" as const,
    },
    blocked: {
      title: "Kayıt silinemiyor ve arşivlenemiyor",
      description: `Bu ${lower} kaydı aşağıdaki sebep(ler)den ötürü silinemiyor ve arşivlenemiyor:`,
      reasons: archiveBlockReasons,
      showConsequences: false,
      primary: "none" as const,
    },
  }[scenario]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>

        <ReasonList reasons={content.reasons} />
        {content.showConsequences && <ArchiveConsequences entityLabel={entityLabel} />}

        <DialogFooter>
          {content.primary === "none" ? (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
              Kapat
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                Vazgeç
              </Button>
              {content.primary === "archive" ? (
                <Button onClick={onConfirmArchive} disabled={isProcessing}>
                  {isProcessing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Archive className="mr-2 h-4 w-4" />
                  )}
                  Arşivle
                </Button>
              ) : (
                <Button
                  onClick={onConfirmDelete}
                  disabled={isProcessing}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {isProcessing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Sil
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
