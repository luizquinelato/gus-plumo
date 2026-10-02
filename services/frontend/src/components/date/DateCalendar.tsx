import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { isDateInRange } from '../../utils/dateUtils'

type CalendarView = 'days' | 'months' | 'years'

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const MONTHS_SHORT_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const YEARS_PER_PAGE = 12

const navBtnCls =
  'flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
const titleBtnCls =
  'rounded-lg px-2.5 py-1 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent dark:text-gray-100 dark:hover:bg-gray-700'
const footerBtnCls =
  'rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'

const selectedStyle: CSSProperties = { backgroundColor: 'var(--color-1)', color: 'var(--on-color-1, #fff)' }
const inRangeStyle: CSSProperties = { backgroundColor: 'color-mix(in srgb, var(--color-1) 16%, transparent)' }

const dayValue = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate()

function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && dayValue(a) === dayValue(b)
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function monthInRange(year: number, month: number, minDate?: Date, maxDate?: Date) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  if (minDate && dayValue(last) < dayValue(minDate)) return false
  if (maxDate && dayValue(first) > dayValue(maxDate)) return false
  return true
}

function yearInRange(year: number, minDate?: Date, maxDate?: Date) {
  if (minDate && year < minDate.getFullYear()) return false
  if (maxDate && year > maxDate.getFullYear()) return false
  return true
}

function cellCls({ selected, current, disabled, muted }: { selected: boolean; current: boolean; disabled: boolean; muted?: boolean }) {
  if (disabled) return 'cursor-not-allowed text-gray-300 dark:text-gray-600'
  if (selected) return 'font-semibold shadow-sm'
  const base = 'hover:bg-gray-100 dark:hover:bg-gray-700'
  const tone = muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'
  const ring = current ? 'ring-1 ring-inset ring-[var(--color-1)] font-semibold' : ''
  return `${base} ${tone} ${ring}`
}

interface BaseProps {
  minDate?: Date
  maxDate?: Date
  /** Quantidade de meses lado a lado na visão de dias */
  monthsShown?: number
  /** `popover` flutua sobre a tela (sombra); `inline` fica embutido no layout */
  variant?: 'popover' | 'inline'
  onClear?: () => void
}

interface SingleProps extends BaseProps {
  mode?: 'single'
  selected: Date | null
  onSelect: (date: Date) => void
}

interface RangeProps extends BaseProps {
  mode: 'range'
  rangeStart: Date | null
  rangeEnd: Date | null
  onRangeChange: (start: Date | null, end: Date | null) => void
}

export type DateCalendarProps = SingleProps | RangeProps

export default function DateCalendar(props: DateCalendarProps) {
  const { minDate, maxDate, monthsShown = 1, variant = 'popover', onClear } = props
  const isRange = props.mode === 'range'
  const anchor = isRange ? props.rangeStart : props.selected

  const today = startOfToday()
  const todayAllowed = isDateInRange(today, minDate, maxDate)

  const initialCursor = () => {
    if (anchor) return new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const base = todayAllowed ? today : (maxDate ?? minDate ?? today)
    return new Date(base.getFullYear(), base.getMonth() - (monthsShown - 1), 1)
  }

  const [view, setView] = useState<CalendarView>('days')
  const [cursor, setCursor] = useState(initialCursor)
  const [yearPageStart, setYearPageStart] = useState(() => {
    const y = cursor.getFullYear()
    return y - (y % YEARS_PER_PAGE)
  })
  const [hovered, setHovered] = useState<Date | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const anchorKey = anchor ? dayValue(anchor) : null
  useEffect(() => {
    if (!anchor) return
    const visibleFirst = new Date(year, month, 1)
    const visibleLast = new Date(year, month + monthsShown, 0)
    if (dayValue(anchor) < dayValue(visibleFirst) || dayValue(anchor) > dayValue(visibleLast)) {
      setCursor(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey])

  const goMonth = (delta: number) => setCursor(new Date(year, month + delta, 1))
  const goYear = (delta: number) => setCursor(new Date(year + delta, month, 1))

  const openMonths = (panelIndex: number) => {
    setCursor(new Date(year, month + panelIndex, 1))
    setView('months')
  }

  const openYears = () => {
    setYearPageStart(year - (year % YEARS_PER_PAGE))
    setView('years')
  }

  const handleDayClick = (day: Date) => {
    if (props.mode !== 'range') {
      props.onSelect(day)
      return
    }
    const { rangeStart, rangeEnd, onRangeChange } = props
    if (!rangeStart || rangeEnd || dayValue(day) < dayValue(rangeStart)) {
      onRangeChange(day, null)
    } else {
      onRangeChange(rangeStart, day)
    }
  }

  const rangeBounds = (() => {
    if (props.mode !== 'range' || !props.rangeStart) return null
    const start = props.rangeStart
    const end = props.rangeEnd ?? (hovered && dayValue(hovered) >= dayValue(start) ? hovered : null)
    return { start: dayValue(start), end: end ? dayValue(end) : null }
  })()

  const dayState = (day: Date) => {
    if (props.mode !== 'range') {
      return { selected: sameDay(day, props.selected), inRange: false }
    }
    if (!rangeBounds) return { selected: false, inRange: false }
    const v = dayValue(day)
    const isEdge = v === rangeBounds.start || (rangeBounds.end !== null && v === rangeBounds.end)
    const inRange = rangeBounds.end !== null && v > rangeBounds.start && v < rangeBounds.end
    return { selected: isEdge, inRange }
  }

  const renderMonthGrid = (panelYear: number, panelMonth: number, showOutside: boolean) => {
    const firstWeekday = new Date(panelYear, panelMonth, 1).getDay()
    const days = Array.from({ length: 42 }, (_, i) => new Date(panelYear, panelMonth, 1 - firstWeekday + i))
    return (
      <>
        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {WEEKDAYS_PT.map((name) => <span key={name} className="py-1">{name}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHovered(null)}>
          {days.map((day) => {
            const outside = day.getMonth() !== panelMonth
            if (outside && !showOutside) return <span key={day.toISOString()} className="h-9" />
            const disabled = !isDateInRange(day, minDate, maxDate)
            const { selected, inRange } = dayState(day)
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                onClick={() => handleDayClick(day)}
                onMouseEnter={isRange ? () => setHovered(day) : undefined}
                className={`h-9 rounded-lg text-sm tabular-nums transition-colors ${cellCls({
                  selected,
                  current: sameDay(day, today),
                  disabled,
                  muted: outside,
                })}`}
                style={selected ? selectedStyle : inRange && !disabled ? inRangeStyle : undefined}
              >
                {day.getDate()}
              </button>
            )
          })}
        </div>
      </>
    )
  }

  const pageEnd = yearPageStart + YEARS_PER_PAGE - 1
  const lastVisible = new Date(year, month + monthsShown - 1, 1)

  const pickerHeader = view === 'months'
    ? {
        title: String(year),
        onTitle: openYears,
        titleHint: 'Escolher ano',
        prev: () => goYear(-1),
        next: () => goYear(1),
        prevDisabled: !yearInRange(year - 1, minDate, maxDate),
        nextDisabled: !yearInRange(year + 1, minDate, maxDate),
      }
    : {
        title: `${yearPageStart} – ${pageEnd}`,
        onTitle: undefined,
        titleHint: undefined,
        prev: () => setYearPageStart(yearPageStart - YEARS_PER_PAGE),
        next: () => setYearPageStart(yearPageStart + YEARS_PER_PAGE),
        prevDisabled: !!minDate && yearPageStart - 1 < minDate.getFullYear(),
        nextDisabled: !!maxDate && pageEnd + 1 > maxDate.getFullYear(),
      }

  const anchorYear = anchor?.getFullYear()
  const anchorMonth = anchor?.getMonth()
  const panelWidth = monthsShown > 1 ? 'w-[17rem]' : 'w-full'
  const frameCls = variant === 'popover'
    ? 'rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-600 dark:bg-gray-800'
    : 'rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-800'
  const widthCls = monthsShown > 1 ? 'w-fit max-w-full' : 'w-[18.5rem]'
  const showFooter = !!onClear || !isRange

  return (
    <div className={`${widthCls} select-none ${frameCls}`}>
      {view === 'days' ? (
        <div className="flex flex-wrap justify-center gap-4">
          {Array.from({ length: monthsShown }, (_, panel) => {
            const panelDate = new Date(year, month + panel, 1)
            const panelYear = panelDate.getFullYear()
            const panelMonth = panelDate.getMonth()
            const isFirst = panel === 0
            const isLast = panel === monthsShown - 1
            return (
              <div key={panel} className={panelWidth}>
                <div className="mb-2 flex items-center justify-between">
                  {isFirst ? (
                    <button
                      type="button"
                      onClick={() => goMonth(-1)}
                      disabled={!monthInRange(year, month - 1, minDate, maxDate)}
                      className={navBtnCls}
                      aria-label="Mês anterior"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  ) : <span className="h-8 w-8" />}
                  <button type="button" onClick={() => openMonths(panel)} className={titleBtnCls} title="Escolher mês">
                    {MONTHS_PT[panelMonth]} {panelYear}
                  </button>
                  {isLast ? (
                    <button
                      type="button"
                      onClick={() => goMonth(1)}
                      disabled={!monthInRange(lastVisible.getFullYear(), lastVisible.getMonth() + 1, minDate, maxDate)}
                      className={navBtnCls}
                      aria-label="Próximo mês"
                    >
                      <ChevronRight size={16} />
                    </button>
                  ) : <span className="h-8 w-8" />}
                </div>
                {renderMonthGrid(panelYear, panelMonth, monthsShown === 1)}
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={pickerHeader.prev} disabled={pickerHeader.prevDisabled} className={navBtnCls} aria-label="Anterior">
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={pickerHeader.onTitle}
              disabled={!pickerHeader.onTitle}
              className={titleBtnCls}
              title={pickerHeader.titleHint}
            >
              {pickerHeader.title}
            </button>
            <button type="button" onClick={pickerHeader.next} disabled={pickerHeader.nextDisabled} className={navBtnCls} aria-label="Próximo">
              <ChevronRight size={16} />
            </button>
          </div>

          {view === 'months' && (
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS_SHORT_PT.map((name, index) => {
                const disabled = !monthInRange(year, index, minDate, maxDate)
                const isSelected = anchorYear === year && anchorMonth === index
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setCursor(new Date(year, index, 1))
                      setView('days')
                    }}
                    className={`h-12 rounded-lg text-sm transition-colors ${cellCls({
                      selected: isSelected,
                      current: today.getFullYear() === year && today.getMonth() === index,
                      disabled,
                    })}`}
                    style={isSelected ? selectedStyle : undefined}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          )}

          {view === 'years' && (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i).map((y) => {
                const disabled = !yearInRange(y, minDate, maxDate)
                const isSelected = anchorYear === y
                return (
                  <button
                    key={y}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setCursor(new Date(y, month, 1))
                      setView('months')
                    }}
                    className={`h-12 rounded-lg text-sm tabular-nums transition-colors ${cellCls({
                      selected: isSelected,
                      current: today.getFullYear() === y,
                      disabled,
                    })}`}
                    style={isSelected ? selectedStyle : undefined}
                  >
                    {y}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {showFooter && (
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 dark:border-gray-700">
          {onClear ? (
            <button type="button" onClick={onClear} className={footerBtnCls}>
              Limpar
            </button>
          ) : <span />}
          {!isRange && (
            <button
              type="button"
              onClick={() => props.onSelect(today)}
              disabled={!todayAllowed}
              className="rounded-lg px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={selectedStyle}
            >
              Hoje
            </button>
          )}
        </div>
      )}
    </div>
  )
}
