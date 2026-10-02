import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar } from 'lucide-react'
import DateCalendar from './DateCalendar'
import {
  dateToLocalString,
  parseLocalDate,
  parseLocalDateTime,
  parseDateBR,
  isDateInRange,
} from '../../utils/dateUtils'

export interface DateFieldProps {
  /** `YYYY-MM-DD`, ou `YYYY-MM-DD HH:mm` quando `withTime` */
  value: string
  onChange: (value: string) => void
  minDate?: Date
  maxDate?: Date
  /** Adiciona segmentos de hora e minuto (hh:mm) */
  withTime?: boolean
  className?: string
  title?: string
  disabled?: boolean
}

export interface DateFieldHandle {
  /** Confirma dígitos pendentes e retorna o valor efetivo (formato de `value` ou '') */
  commitPending: () => string
}

type SegmentKey = 'day' | 'month' | 'year' | 'hour' | 'minute'
type Segments = Record<SegmentKey, string>

interface SegmentConfig {
  key: SegmentKey
  length: number
  placeholder: string
  label: string
  widthCls: string
  separator?: string
}

const EMPTY_SEGMENTS: Segments = { day: '', month: '', year: '', hour: '', minute: '' }

const DATE_SEGMENTS: SegmentConfig[] = [
  { key: 'day', length: 2, placeholder: 'dd', label: 'Dia', widthCls: 'w-6', separator: '/' },
  { key: 'month', length: 2, placeholder: 'mm', label: 'Mês', widthCls: 'w-6', separator: '/' },
  { key: 'year', length: 4, placeholder: 'aaaa', label: 'Ano', widthCls: 'w-10' },
]
const TIME_SEGMENTS: SegmentConfig[] = [
  { key: 'hour', length: 2, placeholder: 'hh', label: 'Hora', widthCls: 'w-6', separator: ':' },
  { key: 'minute', length: 2, placeholder: 'mm', label: 'Minuto', widthCls: 'w-6' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')

const segmentClass =
  'bg-transparent px-0 text-center outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500'

const DateField = forwardRef<DateFieldHandle, DateFieldProps>(({
  value,
  onChange,
  minDate,
  maxDate,
  withTime = false,
  className = '',
  title,
  disabled,
}, ref) => {
  const [segments, setSegments] = useState<Segments>(EMPTY_SEGMENTS)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const isEditingRef = useRef(false)
  const segmentsRef = useRef<Segments>(EMPTY_SEGMENTS)

  segmentsRef.current = segments

  const segmentConfigs = withTime ? [...DATE_SEGMENTS, ...TIME_SEGMENTS] : DATE_SEGMENTS
  const parseValue = (raw: string) => (raw ? (withTime ? parseLocalDateTime(raw) : parseLocalDate(raw)) : null)
  const selected = parseValue(value)

  const syncFromValue = (raw: string) => {
    const parsed = parseValue(raw)
    if (!parsed) {
      setSegments(EMPTY_SEGMENTS)
      return
    }
    setSegments({
      day: pad2(parsed.getDate()),
      month: pad2(parsed.getMonth() + 1),
      year: String(parsed.getFullYear()),
      hour: withTime ? pad2(parsed.getHours()) : '',
      minute: withTime ? pad2(parsed.getMinutes()) : '',
    })
  }

  useEffect(() => {
    if (!isEditingRef.current) {
      syncFromValue(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, withTime])

  useLayoutEffect(() => {
    if (!calendarOpen) {
      setPopupPos(null)
      return
    }
    const margin = 8
    const gap = 4
    const place = () => {
      const button = buttonRef.current
      const popup = popupRef.current
      if (!button || !popup) return
      const anchor = button.getBoundingClientRect()
      const { width, height } = popup.getBoundingClientRect()
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight

      let top = anchor.bottom + gap
      if (top + height > viewportH - margin) {
        const above = anchor.top - gap - height
        top = above >= margin ? above : Math.max(margin, viewportH - height - margin)
      }
      const left = Math.min(Math.max(margin, anchor.right - width), viewportW - width - margin)
      setPopupPos({ top, left })
    }
    place()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (observer && popupRef.current) observer.observe(popupRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [calendarOpen])

  useEffect(() => {
    if (!calendarOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setCalendarOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setCalendarOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [calendarOpen])

  const formatValue = (date: Date) =>
    withTime
      ? `${dateToLocalString(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      : dateToLocalString(date)

  /** Evita reemitir o mesmo instante (ex.: blur sem edição descartaria os segundos do valor original) */
  const emitChange = (nextValue: string) => {
    if (selected && formatValue(selected) === nextValue) return
    onChange(nextValue)
  }

  const commitSegments = (seg: Segments, options?: { force?: boolean }): string => {
    const force = options?.force ?? false
    const revert = () => {
      if (force) syncFromValue(value)
      return value
    }

    const dateEmpty = !seg.day.trim() && !seg.month.trim() && !seg.year.trim()
    const timeEmpty = !seg.hour.trim() && !seg.minute.trim()
    if (dateEmpty && (!withTime || timeEmpty)) {
      onChange('')
      return ''
    }

    if (seg.day.length < 1 || seg.month.length < 1 || seg.year.length < 4) return revert()

    const paddedDay = seg.day.padStart(2, '0')
    const paddedMonth = seg.month.padStart(2, '0')
    const parsed = parseDateBR(`${paddedDay}/${paddedMonth}/${seg.year}`)
    if (!parsed || !isDateInRange(parsed, minDate, maxDate)) return revert()

    let nextValue = dateToLocalString(parsed)
    let paddedHour = ''
    let paddedMinute = ''
    if (withTime) {
      paddedHour = (seg.hour || '0').padStart(2, '0')
      paddedMinute = (seg.minute || '0').padStart(2, '0')
      if (Number(paddedHour) > 23 || Number(paddedMinute) > 59) return revert()
      nextValue += ` ${paddedHour}:${paddedMinute}`
    }

    emitChange(nextValue)
    setSegments({ day: paddedDay, month: paddedMonth, year: seg.year, hour: paddedHour, minute: paddedMinute })
    return nextValue
  }

  useImperativeHandle(ref, () => ({
    commitPending: () => {
      isEditingRef.current = false
      return commitSegments(segmentsRef.current, { force: true })
    },
  }))

  const setSegment = (key: SegmentKey, next: string) => {
    setSegments((prev) => ({ ...prev, [key]: next }))
  }

  const focusSegment = (index: number) => {
    const input = inputRefs.current[index]
    if (!input) return
    input.focus()
    input.select()
  }

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    isEditingRef.current = true
    event.target.select()
  }

  const handleBlur = () => {
    window.setTimeout(() => {
      if (containerRef.current?.contains(document.activeElement)) return
      isEditingRef.current = false
      commitSegments(segmentsRef.current, { force: true })
    }, 0)
  }

  const handleSegmentInput = (index: number, raw: string) => {
    const config = segmentConfigs[index]
    const next = raw.replace(/\D/g, '').slice(0, config.length)
    setSegment(config.key, next)
    if (next.length === config.length) focusSegment(index + 1)
  }

  const handleSegmentKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    const config = segmentConfigs[index]
    const current = segments[config.key]
    const input = event.currentTarget
    const hasSelection = (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0)

    if (event.key === 'Backspace') {
      event.preventDefault()
      if (hasSelection) {
        setSegment(config.key, '')
      } else if (current.length > 0) {
        setSegment(config.key, current.slice(0, -1))
      } else {
        focusSegment(index - 1)
      }
      return
    }

    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      const next = hasSelection || current.length === 0 || current.length >= config.length
        ? event.key
        : current + event.key
      setSegment(config.key, next)
      if (next.length === config.length) focusSegment(index + 1)
    }
  }

  const handleSegmentPaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const config = segmentConfigs[index]
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, config.length)
    if (!pasted) return
    setSegment(config.key, pasted)
    if (pasted.length === config.length) focusSegment(index + 1)
  }

  const closeCalendar = () => {
    setCalendarOpen(false)
    isEditingRef.current = false
  }

  const handleCalendarSelect = (date: Date) => {
    if (!isDateInRange(date, minDate, maxDate)) return
    let nextValue = dateToLocalString(date)
    if (withTime) {
      const hour = selected ? pad2(selected.getHours()) : (segmentsRef.current.hour || '00').padStart(2, '0')
      const minute = selected ? pad2(selected.getMinutes()) : (segmentsRef.current.minute || '00').padStart(2, '0')
      nextValue += ` ${hour}:${minute}`
    }
    emitChange(nextValue)
    closeCalendar()
  }

  const handleCalendarClear = () => {
    onChange('')
    closeCalendar()
  }

  return (
    <div
      ref={containerRef}
      data-date-field
      className={`flex items-center w-full ${className}`}
      title={title}
    >
      <div className="flex items-center">
        {segmentConfigs.map((config, index) => (
          <React.Fragment key={config.key}>
            {config.key === 'hour' && <span className="w-2" />}
            <input
              ref={(el) => { inputRefs.current[index] = el }}
              type="text"
              inputMode="numeric"
              value={segments[config.key]}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={(e) => handleSegmentInput(index, e.target.value)}
              onKeyDown={(e) => handleSegmentKeyDown(index, e)}
              onPaste={(e) => handleSegmentPaste(index, e)}
              placeholder={config.placeholder}
              disabled={disabled}
              aria-label={config.label}
              className={`${config.widthCls} ${segmentClass}`}
            />
            {config.separator && (
              <span className="text-gray-400 select-none leading-none">{config.separator}</span>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="relative ml-auto flex-shrink-0 pl-1">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setCalendarOpen(true)}
          disabled={disabled}
          className="p-1 text-gray-400 hover:text-color-primary transition-colors disabled:opacity-50"
          title="Abrir calendário"
          tabIndex={-1}
        >
          <Calendar size={18} />
        </button>
        {calendarOpen && createPortal(
          <div
            ref={popupRef}
            className="fixed z-[1000]"
            style={{
              top: popupPos?.top ?? 0,
              left: popupPos?.left ?? 0,
              visibility: popupPos ? 'visible' : 'hidden',
            }}
          >
            <DateCalendar
              selected={selected}
              minDate={minDate}
              maxDate={maxDate}
              onSelect={handleCalendarSelect}
              onClear={handleCalendarClear}
            />
          </div>,
          document.body,
        )}
      </div>
    </div>
  )
})

DateField.displayName = 'DateField'

export default DateField
