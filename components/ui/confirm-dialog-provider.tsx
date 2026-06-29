"use client"

import * as React from "react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  /** Onay butonu metni. Varsayılan: "Onayla". */
  confirmLabel?: string
  /** Vazgeç butonu metni. Varsayılan: "Vazgeç". */
  cancelLabel?: string
  /** "destructive" → kırmızı onay (silme/iptal gibi geri alınamaz işlemler). */
  variant?: "default" | "destructive"
}

export interface PromptOptions extends ConfirmOptions {
  /** Giriş alanının üstündeki etiket. */
  label?: string
  placeholder?: string
  defaultValue?: string
  /** Onay için gereken minimum (trim'lenmiş) karakter sayısı. */
  minLength?: number
}

interface ConfirmContextValue {
  /** Stillenmiş onay diyaloğu; kullanıcı onaylarsa true döner. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** Metin girişli onay diyaloğu; onaylanırsa girilen metin, iptalde null döner. */
  prompt: (opts: PromptOptions) => Promise<string | null>
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null)

/**
 * Uygulama geneli imperatif onay/giriş diyaloğu. `window.confirm` / `window.prompt`
 * yerine kullanılır:
 *   const { confirm, prompt } = useConfirm()
 *   if (!(await confirm({ title: "...", variant: "destructive" }))) return
 *   const note = await prompt({ title: "...", minLength: 3 }); if (note === null) return
 */
export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within ConfirmDialogProvider")
  return ctx
}

type InternalState =
  | { kind: "idle" }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<InternalState>({ kind: "idle" })
  const [value, setValue] = React.useState("")

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ kind: "confirm", opts, resolve })
    })
  }, [])

  const prompt = React.useCallback((opts: PromptOptions) => {
    setValue(opts.defaultValue ?? "")
    return new Promise<string | null>((resolve) => {
      setState({ kind: "prompt", opts, resolve })
    })
  }, [])

  const handleConfirm = () => {
    setState((s) => {
      if (s.kind === "confirm") s.resolve(true)
      else if (s.kind === "prompt") s.resolve(value)
      return { kind: "idle" }
    })
  }

  // Diyalog kapanışı (Vazgeç / ESC / dış tık) → reddet.
  const handleOpenChange = (open: boolean) => {
    if (open) return
    setState((s) => {
      if (s.kind === "confirm") s.resolve(false)
      else if (s.kind === "prompt") s.resolve(null)
      return { kind: "idle" }
    })
  }

  const opts = state.kind !== "idle" ? state.opts : null
  const isPrompt = state.kind === "prompt"
  const minLength = state.kind === "prompt" ? state.opts.minLength ?? 0 : 0

  const ctxValue = React.useMemo(() => ({ confirm, prompt }), [confirm, prompt])

  return (
    <ConfirmContext.Provider value={ctxValue}>
      {children}
      <ConfirmDialog
        open={state.kind !== "idle"}
        onOpenChange={handleOpenChange}
        title={opts?.title ?? ""}
        description={opts?.description}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        variant={opts?.variant}
        confirmDisabled={isPrompt && value.trim().length < minLength}
        onConfirm={handleConfirm}
      >
        {isPrompt ? (
          <div className="space-y-1.5">
            {(state as Extract<InternalState, { kind: "prompt" }>).opts.label ? (
              <label htmlFor="confirm-prompt-input" className="text-sm font-medium">
                {(state as Extract<InternalState, { kind: "prompt" }>).opts.label}
              </label>
            ) : null}
            <Input
              id="confirm-prompt-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={(state as Extract<InternalState, { kind: "prompt" }>).opts.placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim().length >= minLength) {
                  e.preventDefault()
                  handleConfirm()
                }
              }}
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </ConfirmContext.Provider>
  )
}
