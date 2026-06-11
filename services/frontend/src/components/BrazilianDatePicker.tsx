import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { Calendar } from 'lucide-react'
import {
  dateToLocalString,
  parseLocalDate,
  parseDateBR,
  isDateInRange,
} from '../utils/dateUtils'

interface BrazilianDatePickerProps {
  value: string
  onChange: (value: string) => void
  minDate?: Date
  maxDate?: Date
  className?: string
  placeholderText?: string
  title?: string
  disabled?: boolean
}

export interface BrazilianDatePickerHandle {
  /** Confirma dígitos pendentes e retorna o valor efetivo (YYYY-MM-DD ou '') */
  commitPending: () => string
}

const BrazilianDatePicker = forwardRef<BrazilianDatePickerHandle, BrazilianDatePickerProps>(({
  value,
  onChange,
  minDate,
  maxDate,
  className = '',
  title,
  disabled,
}, ref) => {
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)

  const dayRef = useRef<HTMLInputElement>(null)
  const monthRef = useRef<HTMLInputElement>(null)
  const yearRef = useRef<HTMLInputElement>(null)
  const isEditingRef = useRef(false)
  const segmentsRef = useRef({ day: '', month: '', year: '' })

  segmentsRef.current = { day, month, year }

  const selected = value ? parseLocalDate(value) : null

  const syncFromValue = (dateValue: string) => {
    const parsed = dateValue ? parseLocalDate(dateValue) : null
    if (parsed) {
      setDay(String(parsed.getDate()).padStart(2, '0'))
      setMonth(String(parsed.getMonth() + 1).padStart(2, '0'))
      setYear(String(parsed.getFullYear()))
    } else {
      setDay('')
      setMonth('')
      setYear('')
    }
  }

  useEffect(() => {
    if (!isEditingRef.current) {
      syncFromValue(value)
    }
  }, [value])

  const commitSegments = (
    d: string,
    m: string,
    y: string,
    options?: { force?: boolean }
  ): string => {
    const force = options?.force ?? false

    if (!d.trim() && !m.trim() && !y.trim()) {
      onChange('')
      return ''
    }

    const incomplete = d.length < 1 || m.length < 1 || y.length < 4

    if (incomplete) {
      if (force) {
        syncFromValue(value)
      }
      return value
    }

    const paddedDay = d.padStart(2, '0')
    const paddedMonth = m.padStart(2, '0')
    const parsed = parseDateBR(`${paddedDay}/${paddedMonth}/${y}`)

    if (!parsed || !isDateInRange(parsed, minDate, maxDate)) {
      if (force) {
        syncFromValue(value)
      }
      return value
    }

    const nextValue = dateToLocalString(parsed)
    onChange(nextValue)
    setDay(paddedDay)
    setMonth(paddedMonth)
    setYear(y)
    return nextValue
  }

  useImperativeHandle(ref, () => ({
    commitPending: () => {
      isEditingRef.current = false
      const { day: d, month: m, year: y } = segmentsRef.current
      return commitSegments(d, m, y, { force: true })
    },
  }))

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    isEditingRef.current = true
    event.target.select()
  }

  const handleBlur = () => {
    window.setTimeout(() => {
      const active = document.activeElement
      const container = dayRef.current?.closest('[data-brazilian-date-picker]')
      if (container?.contains(active)) return

      isEditingRef.current = false
      commitSegments(
        segmentsRef.current.day,
        segmentsRef.current.month,
        segmentsRef.current.year,
        { force: true }
      )
    }, 0)
  }

  const applyDigit = (
    key: string,
    current: string,
    maxLen: number,
    hasSelection: boolean
  ): string => {
    if (hasSelection || current.length === 0) {
      return key
    }
    if (current.length < maxLen) {
      return current + key
    }
    return key
  }

  const handleSegmentInput = (
    raw: string,
    maxLen: number,
    setCurrent: (next: string) => void,
    nextRef?: React.RefObject<HTMLInputElement | null>
  ) => {
    const next = raw.replace(/\D/g, '').slice(0, maxLen)
    setCurrent(next)

    if (next.length === maxLen && nextRef?.current) {
      nextRef.current.focus()
      nextRef.current.select()
    }
  }

  const handleSegmentKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    maxLen: number,
    getCurrent: () => string,
    setCurrent: (next: string) => void,
    nextRef?: React.RefObject<HTMLInputElement | null>,
    prevRef?: React.RefObject<HTMLInputElement | null>
  ) => {
    const input = event.currentTarget
    const hasSelection = (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0)

    if (event.key === 'Backspace') {
      event.preventDefault()
      const current = getCurrent()
      if (hasSelection) {
        setCurrent('')
      } else if (current.length > 0) {
        setCurrent(current.slice(0, -1))
      } else if (prevRef?.current) {
        prevRef.current.focus()
        prevRef.current.select()
      }
      return
    }

    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      const next = applyDigit(event.key, getCurrent(), maxLen, hasSelection)
      setCurrent(next)

      if (next.length === maxLen && nextRef?.current) {
        nextRef.current.focus()
        nextRef.current.select()
      }
    }
  }

  const handleSegmentPaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    maxLen: number,
    setCurrent: (next: string) => void,
    nextRef?: React.RefObject<HTMLInputElement | null>
  ) => {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, maxLen)
    if (!pasted) return

    setCurrent(pasted)
    if (pasted.length === maxLen && nextRef?.current) {
      nextRef.current.focus()
      nextRef.current.select()
    }
  }

  const handleCalendarChange = (date: Date | null) => {
    if (!date) {
      onChange('')
      setCalendarOpen(false)
      isEditingRef.current = false
      return
    }
    if (!isDateInRange(date, minDate, maxDate)) return
    onChange(dateToLocalString(date))
    setCalendarOpen(false)
    isEditingRef.current = false
  }

  const segmentClass =
    'bg-transparent text-center outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500'

  return (
    <div
      data-brazilian-date-picker
      className={`flex items-center w-full ${className}`}
      title={title}
    >
      <div className="flex items-center">
        <input
          ref={dayRef}
          type="text"
          inputMode="numeric"
          value={day}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleSegmentInput(e.target.value, 2, setDay, monthRef)}
          onKeyDown={(e) => handleSegmentKeyDown(e, 2, () => day, setDay, monthRef)}
          onPaste={(e) => handleSegmentPaste(e, 2, setDay, monthRef)}
          placeholder="dd"
          disabled={disabled}
          aria-label="Dia"
          className={`w-6 px-0 ${segmentClass}`}
        />
        <span className="text-gray-400 select-none leading-none">/</span>
        <input
          ref={monthRef}
          type="text"
          inputMode="numeric"
          value={month}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleSegmentInput(e.target.value, 2, setMonth, yearRef)}
          onKeyDown={(e) => handleSegmentKeyDown(e, 2, () => month, setMonth, yearRef, dayRef)}
          onPaste={(e) => handleSegmentPaste(e, 2, setMonth, yearRef)}
          placeholder="mm"
          disabled={disabled}
          aria-label="Mês"
          className={`w-6 px-0 ${segmentClass}`}
        />
        <span className="text-gray-400 select-none leading-none">/</span>
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          value={year}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleSegmentInput(e.target.value, 4, setYear)}
          onKeyDown={(e) => handleSegmentKeyDown(e, 4, () => year, setYear, undefined, monthRef)}
          onPaste={(e) => handleSegmentPaste(e, 4, setYear)}
          placeholder="aaaa"
          disabled={disabled}
          aria-label="Ano"
          className={`w-10 px-0 ${segmentClass}`}
        />
      </div>

      <div className="relative ml-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => !disabled && setCalendarOpen(true)}
          disabled={disabled}
          className="p-1 text-gray-400 hover:text-color-primary transition-colors disabled:opacity-50"
          title="Abrir calendário"
          tabIndex={-1}
        >
          <Calendar size={18} />
        </button>
        {calendarOpen && (
          <div className="absolute right-0 top-full z-50 mt-1">
            <DatePicker
              selected={selected}
              onChange={handleCalendarChange}
              inline
              minDate={minDate}
              maxDate={maxDate}
              onClickOutside={() => setCalendarOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
})

BrazilianDatePicker.displayName = 'BrazilianDatePicker'

export default BrazilianDatePicker
