"use client"

// Etiket Tasarımcısı — merkezi editör state'i (useReducer + snapshot geçmişi).
// İki aksiyon sınıfı vardır:
//  - transient (DRAG_UPDATE): pointermove sırasında yalnız design'ı günceller,
//    geçmişe YAZMAZ; jest bitince tek COMMIT snapshot alır → jest başına 1 undo.
//  - committing (geri kalanı): değişiklik + snapshot + dirty.

import { useCallback, useMemo, useReducer } from "react"
import type {
  LabelDesign,
  LabelElement,
  LabelPage,
} from "@/lib/labels/types"
import { createDefaultDesign, makeElementId, normalizeLabelDesign } from "@/lib/labels/types"

const HISTORY_CAP = 50

export interface TemplateMeta {
  id: string | null
  name: string
  isDefault: boolean
}

interface DesignerState {
  design: LabelDesign
  selectedId: string | null
  history: { stack: LabelDesign[]; index: number }
  dirty: boolean
  template: TemplateMeta
}

type RectPatch = Partial<Pick<LabelElement, "x" | "y" | "w" | "h">>

type Action =
  | { type: "SELECT"; id: string | null }
  | { type: "DRAG_UPDATE"; id: string; patch: RectPatch }
  | { type: "COMMIT" }
  | { type: "ADD_ELEMENT"; element: LabelElement }
  | { type: "DELETE_ELEMENT"; id: string }
  | { type: "DUPLICATE_ELEMENT"; id: string }
  | { type: "PATCH_ELEMENT"; id: string; patch: Partial<LabelElement> }
  | { type: "SET_PAGE"; patch: Partial<LabelPage> }
  | { type: "REORDER_Z"; id: string; dir: "up" | "down" }
  | { type: "LOAD_DESIGN"; design: LabelDesign; template: TemplateMeta }
  | { type: "MARK_SAVED"; template: TemplateMeta }
  | { type: "UNDO" }
  | { type: "REDO" }

/** Elemanları z sırasına dizip z'yi 0..n-1 olarak yeniden atar (değişmez kural). */
function normZ(elements: LabelElement[]): LabelElement[] {
  return [...elements]
    .sort((a, b) => a.z - b.z)
    .map((el, i) => (el.z === i ? el : { ...el, z: i }))
}

function pushHistory(state: DesignerState, design: LabelDesign): DesignerState {
  const stack = state.history.stack.slice(0, state.history.index + 1)
  stack.push(design)
  const overflow = Math.max(0, stack.length - HISTORY_CAP)
  return {
    ...state,
    design,
    dirty: true,
    history: { stack: stack.slice(overflow), index: stack.length - 1 - overflow },
  }
}

function withElements(design: LabelDesign, elements: LabelElement[]): LabelDesign {
  return { ...design, elements: normZ(elements) }
}

function initialState(): DesignerState {
  const design = createDefaultDesign()
  return {
    design,
    selectedId: null,
    history: { stack: [design], index: 0 },
    dirty: false,
    template: { id: null, name: "", isDefault: false },
  }
}

function reducer(state: DesignerState, action: Action): DesignerState {
  switch (action.type) {
    case "SELECT":
      return state.selectedId === action.id ? state : { ...state, selectedId: action.id }

    case "DRAG_UPDATE": {
      // Transient: geçmişe dokunma (COMMIT jest sonunda alınır).
      const elements = state.design.elements.map((el) =>
        el.id === action.id ? ({ ...el, ...action.patch } as LabelElement) : el
      )
      return { ...state, design: { ...state.design, elements } }
    }

    case "COMMIT": {
      const current = state.design
      const last = state.history.stack[state.history.index]
      if (last === current) return state // değişiklik yoksa snapshot alma
      return pushHistory(state, current)
    }

    case "ADD_ELEMENT": {
      const design = withElements(state.design, [
        ...state.design.elements,
        { ...action.element, z: state.design.elements.length },
      ])
      return { ...pushHistory(state, design), selectedId: action.element.id }
    }

    case "DELETE_ELEMENT": {
      const elements = state.design.elements.filter((el) => el.id !== action.id)
      if (elements.length === state.design.elements.length) return state
      return {
        ...pushHistory(state, withElements(state.design, elements)),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      }
    }

    case "DUPLICATE_ELEMENT": {
      const source = state.design.elements.find((el) => el.id === action.id)
      if (!source) return state
      const copy: LabelElement = {
        ...source,
        id: makeElementId(),
        x: Math.min(source.x + 1, state.design.page.widthMm - 1),
        y: Math.min(source.y + 1, state.design.page.heightMm - 1),
        z: state.design.elements.length,
      }
      const design = withElements(state.design, [...state.design.elements, copy])
      return { ...pushHistory(state, design), selectedId: copy.id }
    }

    case "PATCH_ELEMENT": {
      let changed = false
      const elements = state.design.elements.map((el) => {
        if (el.id !== action.id) return el
        changed = true
        return { ...el, ...action.patch } as LabelElement
      })
      if (!changed) return state
      return pushHistory(state, { ...state.design, elements })
    }

    case "SET_PAGE": {
      const page: LabelPage = { ...state.design.page, ...action.patch }
      if (page.labelType === "A4" && !page.a4) {
        page.a4 = { marginTopMm: 10, marginLeftMm: 5 }
      }
      return pushHistory(state, { ...state.design, page })
    }

    case "REORDER_Z": {
      const sorted = normZ(state.design.elements)
      const idx = sorted.findIndex((el) => el.id === action.id)
      if (idx < 0) return state
      const target = action.dir === "up" ? idx + 1 : idx - 1
      if (target < 0 || target >= sorted.length) return state
      const swapped = [...sorted]
      ;[swapped[idx], swapped[target]] = [swapped[target], swapped[idx]]
      return pushHistory(state, withElements(state.design, swapped.map((el, i) => ({ ...el, z: i }))))
    }

    case "LOAD_DESIGN": {
      const design = normalizeLabelDesign(action.design)
      return {
        design,
        selectedId: null,
        history: { stack: [design], index: 0 },
        dirty: false,
        template: action.template,
      }
    }

    case "MARK_SAVED":
      return { ...state, dirty: false, template: action.template }

    case "UNDO": {
      if (state.history.index <= 0) return state
      const index = state.history.index - 1
      return {
        ...state,
        design: state.history.stack[index],
        history: { ...state.history, index },
        dirty: true,
        selectedId: null,
      }
    }

    case "REDO": {
      if (state.history.index >= state.history.stack.length - 1) return state
      const index = state.history.index + 1
      return {
        ...state,
        design: state.history.stack[index],
        history: { ...state.history, index },
        dirty: true,
        selectedId: null,
      }
    }

    default:
      return state
  }
}

export interface DesignerApi {
  design: LabelDesign
  selectedId: string | null
  selectedElement: LabelElement | null
  dirty: boolean
  template: TemplateMeta
  canUndo: boolean
  canRedo: boolean
  select: (id: string | null) => void
  dragUpdate: (id: string, patch: RectPatch) => void
  commitGesture: () => void
  addElement: (element: LabelElement) => void
  deleteElement: (id: string) => void
  duplicateElement: (id: string) => void
  patchElement: (id: string, patch: Partial<LabelElement>) => void
  setPage: (patch: Partial<LabelPage>) => void
  reorderZ: (id: string, dir: "up" | "down") => void
  loadDesign: (design: LabelDesign, template: TemplateMeta) => void
  markSaved: (template: TemplateMeta) => void
  undo: () => void
  redo: () => void
}

export function useLabelDesignerState(): DesignerApi {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  const select = useCallback((id: string | null) => dispatch({ type: "SELECT", id }), [])
  const dragUpdate = useCallback(
    (id: string, patch: RectPatch) => dispatch({ type: "DRAG_UPDATE", id, patch }),
    []
  )
  const commitGesture = useCallback(() => dispatch({ type: "COMMIT" }), [])
  const addElement = useCallback(
    (element: LabelElement) => dispatch({ type: "ADD_ELEMENT", element }),
    []
  )
  const deleteElement = useCallback((id: string) => dispatch({ type: "DELETE_ELEMENT", id }), [])
  const duplicateElement = useCallback(
    (id: string) => dispatch({ type: "DUPLICATE_ELEMENT", id }),
    []
  )
  const patchElement = useCallback(
    (id: string, patch: Partial<LabelElement>) => dispatch({ type: "PATCH_ELEMENT", id, patch }),
    []
  )
  const setPage = useCallback((patch: Partial<LabelPage>) => dispatch({ type: "SET_PAGE", patch }), [])
  const reorderZ = useCallback(
    (id: string, dir: "up" | "down") => dispatch({ type: "REORDER_Z", id, dir }),
    []
  )
  const loadDesign = useCallback(
    (design: LabelDesign, template: TemplateMeta) =>
      dispatch({ type: "LOAD_DESIGN", design, template }),
    []
  )
  const markSaved = useCallback(
    (template: TemplateMeta) => dispatch({ type: "MARK_SAVED", template }),
    []
  )
  const undo = useCallback(() => dispatch({ type: "UNDO" }), [])
  const redo = useCallback(() => dispatch({ type: "REDO" }), [])

  const selectedElement = useMemo(
    () => state.design.elements.find((el) => el.id === state.selectedId) ?? null,
    [state.design.elements, state.selectedId]
  )

  return {
    design: state.design,
    selectedId: state.selectedId,
    selectedElement,
    dirty: state.dirty,
    template: state.template,
    canUndo: state.history.index > 0,
    canRedo: state.history.index < state.history.stack.length - 1,
    select,
    dragUpdate,
    commitGesture,
    addElement,
    deleteElement,
    duplicateElement,
    patchElement,
    setPage,
    reorderZ,
    loadDesign,
    markSaved,
    undo,
    redo,
  }
}
