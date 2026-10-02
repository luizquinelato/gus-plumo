import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import {
  CadastroFieldLabel,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'

export type PdfPasswordMode = 'single' | 'per_file'

export interface PdfPasswordModalFile {
  filename: string
}

interface PdfImportPasswordModalProps {
  isOpen: boolean
  files: PdfPasswordModalFile[]
  onCancel: () => void
  onConfirm: (passwordsByFilename: Record<string, string>) => void
}

const PdfImportPasswordModal = ({
  isOpen,
  files,
  onCancel,
  onConfirm,
}: PdfImportPasswordModalProps) => {
  const [mode, setMode] = useState<PdfPasswordMode>('single')
  const [singlePassword, setSinglePassword] = useState('')
  const [perFilePasswords, setPerFilePasswords] = useState<Record<string, string>>({})
  const [showPasswords, setShowPasswords] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setMode('single')
    setSinglePassword('')
    setPerFilePasswords(Object.fromEntries(files.map((f) => [f.filename, ''])))
    setShowPasswords(false)
  }, [isOpen, files])

  const canConfirm = useMemo(() => {
    if (files.length === 0) return false
    if (mode === 'single') return singlePassword.trim().length > 0
    return files.every((f) => (perFilePasswords[f.filename] ?? '').trim().length > 0)
  }, [files, mode, singlePassword, perFilePasswords])

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return
    if (mode === 'single') {
      const pwd = singlePassword.trim()
      onConfirm(Object.fromEntries(files.map((f) => [f.filename, pwd])))
      return
    }
    const mapped: Record<string, string> = {}
    files.forEach((f) => {
      mapped[f.filename] = (perFilePasswords[f.filename] ?? '').trim()
    })
    onConfirm(mapped)
  }, [canConfirm, mode, singlePassword, perFilePasswords, files, onConfirm])

  useEffect(() => {
    if (!isOpen || files.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if (!canConfirm) return
      e.preventDefault()
      handleConfirm()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, files.length, canConfirm, handleConfirm])

  if (!isOpen || files.length === 0) return null

  return (
    <CadastroModalShell maxWidth="max-w-3xl" onBackdropClick={onCancel}>
      <CadastroModalHeader
        isEdit={false}
        title="Senha dos PDFs"
        subtitle="Um ou mais arquivos estão protegidos. Informe a senha para continuar a leitura."
        onClose={onCancel}
        icon={<Lock size={18} />}
      />
      <CadastroModalBody>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className={cadastroOptionLabelCls}>
              <input
                type="radio"
                name="pdf-password-mode"
                checked={mode === 'single'}
                onChange={() => setMode('single')}
                className={cadastroAccentControlCls}
              />
              Mesma senha para todos ({files.length})
            </label>
            <label className={cadastroOptionLabelCls}>
              <input
                type="radio"
                name="pdf-password-mode"
                checked={mode === 'per_file'}
                onChange={() => setMode('per_file')}
                className={cadastroAccentControlCls}
              />
              Senha por arquivo
            </label>
          </div>

          {mode === 'single' ? (
            <label className="block">
              <CadastroFieldLabel required>Senha</CadastroFieldLabel>
              <div className="relative mt-0.5">
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={singlePassword}
                  onChange={(e) => setSinglePassword(e.target.value)}
                  className={`${cadastroFieldCls} pr-10`}
                  autoComplete="off"
                  placeholder="Senha de abertura do PDF"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  tabIndex={-1}
                  aria-label={showPasswords ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {files.map((file) => (
                <li key={file.filename} className="flex items-center gap-4">
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100"
                    title={file.filename}
                  >
                    {file.filename}
                  </span>
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={perFilePasswords[file.filename] ?? ''}
                    onChange={(e) =>
                      setPerFilePasswords((prev) => ({ ...prev, [file.filename]: e.target.value }))
                    }
                    className={`${cadastroFieldCls} w-52 shrink-0 sm:w-64 md:w-72`}
                    autoComplete="off"
                    placeholder="Senha"
                    aria-label={`Senha de ${file.filename}`}
                  />
                </li>
              ))}
            </ul>
          )}

          <label className={`${cadastroOptionLabelCls} text-xs text-gray-500 dark:text-gray-400`}>
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className={`${cadastroAccentControlCls} h-3.5 w-3.5`}
            />
            Mostrar senhas
          </label>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            A senha é usada apenas para abrir o PDF durante a importação e não é armazenada no Plumo.
          </p>
        </div>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onCancel}
        onSave={handleConfirm}
        saveLabel="Continuar"
        disabled={!canConfirm}
        closeLabel="Cancelar"
      />
    </CadastroModalShell>
  )
}

export default PdfImportPasswordModal
