import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cadastroFieldCls } from './CadastroFormLayout'

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTHS_FULL = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/** Mês como inteiro: ano * 12 + (mês - 1). */
export type YearMonth = number

interface MonthPickerProps {
  value: YearMonth
  min: YearMonth
  max: YearMonth
  onChange: (value: YearMonth) => void
  disabled?: boolean
}

const POPOVER_WIDTH = 256
const POPOVER_HEIGHT = 290

const yearOf = (ym: YearMonth) => Math.floor(ym / 12)
const navBtnCls =
  'flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700'

/** Seletor de mês: botão com o mês escolhido que abre uma grade 3×4 com navegação por ano. */
const MonthPicker = ({ value, min, max, onChange, disabled }: MonthPickerProps) => {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(yearOf(value))
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 })

  // O popover sai do fluxo do modal (portal + fixed) para não ficar cortado; abre para cima se faltar espaço embaixo.
  const reposition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
    const openUp = window.innerHeight - rect.bottom < POPOVER_HEIGHT + 8 && rect.top > POPOVER_HEIGHT + 8
    setPos(openUp ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 })
  }, [])

  useEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    // Captura: o Esc fecha só o seletor, sem fechar o modal por trás.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const toggle = () => {
    if (disabled) return
    setYear(yearOf(value))
    setOpen((prev) => !prev)
  }

  // "Hoje": mês atual; se estiver fora do período permitido, o mais próximo dentro dele.
  const now = new Date()
  const todayYm = now.getFullYear() * 12 + now.getMonth()
  const todayTarget = Math.min(Math.max(todayYm, min), max)
  const todayClamped = todayTarget !== todayYm

  const pick = (ym: YearMonth) => {
    onChange(ym)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${cadastroFieldCls} flex w-full items-center justify-between gap-2 text-left font-semibold disabled:opacity-50`}
      >
        <span>
          {MONTHS_FULL[value % 12]} de {yearOf(value)}
        </span>
        <CalendarDays size={16} className="shrink-0 text-gray-400" />
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Escolher mês"
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: POPOVER_WIDTH }}
          className="z-[1000] rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-600 dark:bg-gray-800"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              disabled={year <= yearOf(min)}
              className={navBtnCls}
              title="Ano anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= yearOf(max)}
              className={navBtnCls}
              title="Próximo ano"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((name, month) => {
              const ym = year * 12 + month
              const outOfRange = ym < min || ym > max
              const selected = ym === value
              return (
                <button
                  key={name}
                  type="button"
                  disabled={outOfRange}
                  onClick={() => pick(ym)}
                  className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    selected
                      ? ''
                      : 'text-gray-700 hover:bg-gray-100 disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                  style={selected ? { background: 'var(--color-1)', color: 'var(--on-color-1, #fff)' } : undefined}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
            <button
              type="button"
              onClick={() => pick(todayTarget)}
              className="rounded-md px-2 py-1 text-sm font-semibold text-[var(--color-1)] transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
              title={
                todayClamped
                  ? 'O mês atual está fora do período disponível; vai para o mês mais próximo.'
                  : 'Voltar ao mês atual'
              }
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => pick(max)}
              className="rounded-md px-2 py-1 text-sm font-semibold text-[var(--color-1)] transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
              title={`Ir para o último mês disponível (${MONTHS[max % 12]}/${yearOf(max)})`}
            >
              Último
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default MonthPicker
