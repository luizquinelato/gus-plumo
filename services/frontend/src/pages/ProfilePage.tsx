import React, { useState } from 'react'
import { User, Lock, Save, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import Sidebar from '../components/Sidebar'
import axios from 'axios'

const inputCls = [
  'w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all',
  'border border-gray-200 dark:border-gray-600',
  'bg-white dark:bg-gray-700',
  'text-gray-800 dark:text-gray-100',
  'placeholder-gray-400 dark:placeholder-gray-500',
  'focus:border-[var(--color-1)] focus:ring-2 focus:ring-[var(--color-1)]/20',
].join(' ')

const sectionTitle = 'flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-4'

export default function ProfilePage() {
  const { user, updateUser } = useAuth()

  const [firstName,   setFirstName]   = useState(user?.primeiro_nome ?? '')
  const [lastName,    setLastName]    = useState(user?.ultimo_nome ?? '')
  const [currentPass,  setCurrentPass]  = useState('')
  const [newPass,      setNewPass]      = useState('')
  const [confirmPass,  setConfirmPass]  = useState('')
  const [showCurrent,  setShowCurrent]  = useState(false)
  const [showNew,      setShowNew]      = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [loadingName, setLoadingName] = useState(false)
  const [loadingPass, setLoadingPass] = useState(false)
  const [success,     setSuccess]     = useState('')
  const [error,       setError]       = useState('')

  function flash(msg: string, isError = false) {
    if (isError) { setError(msg); setSuccess('') }
    else         { setSuccess(msg); setError('') }
    setTimeout(() => { setSuccess(''); setError('') }, 3500)
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setLoadingName(true)
    try {
      const { data } = await axios.patch('/api/users/me', {
        first_name: firstName,
        last_name: lastName,
      })
      updateUser({
        primeiro_nome: data.first_name ?? '',
        ultimo_nome: data.last_name ?? '',
        nome: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim(),
      })
      flash('Nome atualizado com sucesso!')
    } catch {
      flash('Erro ao salvar o nome.', true)
    } finally {
      setLoadingName(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPass) return flash('Informe a senha atual.', true)
    if (newPass !== confirmPass) return flash('Nova senha e confirmação não coincidem.', true)
    if (newPass.length < 6) return flash('A nova senha deve ter pelo menos 6 caracteres.', true)
    setLoadingPass(true)
    try {
      await axios.patch('/api/users/me/password', {
        current_password: currentPass,
        new_password: newPass,
      })
      setCurrentPass('')
      setNewPass('')
      setConfirmPass('')
      flash('Senha alterada com sucesso!')
    } catch {
      flash('Senha atual incorreta.', true)
    } finally {
      setLoadingPass(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-color-primary-light rounded-lg">
          <User className="h-6 w-6 text-color-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Perfil</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie seus dados e senha de acesso</p>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
          <CheckCircle size={14} />{success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Dados */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        <p className={sectionTitle}><User size={13} />Dados</p>
        <form onSubmit={handleSaveName} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Nome</label>
              <input className={inputCls} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Seu nome" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Sobrenome</label>
              <input className={inputCls} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Seu sobrenome" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Email</label>
            <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={user?.email ?? ''} disabled />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Função</label>
            <input className={`${inputCls} opacity-60 cursor-not-allowed capitalize`} value={user?.is_admin ? 'Administrador' : 'Usuário'} disabled />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={loadingName}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-white transition-opacity"
              style={{ background: 'var(--gradient-1-2)', opacity: loadingName ? 0.7 : 1, cursor: loadingName ? 'not-allowed' : 'pointer' }}>
              <Save size={14} />{loadingName ? 'Salvando...' : 'Salvar Dados'}
            </button>
          </div>
        </form>
      </section>

      {/* Segurança */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        <p className={sectionTitle}><Lock size={13} />Segurança</p>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Senha Atual</label>
            <div className="relative">
              <input type={showCurrent ? 'text' : 'password'} autoComplete="current-password" className={`${inputCls} pr-11`} value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Digite sua senha atual" />
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowCurrent(p => !p)} tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Nova Senha</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} autoComplete="new-password" className={`${inputCls} pr-11`} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mínimo 6 caracteres" />
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowNew(p => !p)} tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Confirmar Nova Senha</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                className={`${inputCls} pr-11 ${confirmPass && newPass !== confirmPass ? 'border-red-400 focus:border-red-400' : ''}`}
                value={confirmPass}
                onChange={e => setConfirmPass(e.target.value)}
                placeholder="Repita a nova senha"
              />
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowConfirm(p => !p)} tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirmPass && newPass !== confirmPass && (
              <p className="mt-1 text-xs text-red-500">As senhas não coincidem</p>
            )}
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={loadingPass}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-white transition-opacity"
              style={{ background: 'var(--gradient-1-2)', opacity: loadingPass ? 0.7 : 1, cursor: loadingPass ? 'not-allowed' : 'pointer' }}>
              <Lock size={14} />{loadingPass ? 'Alterando...' : 'Alterar Senha'}
            </button>
          </div>
        </form>
      </section>

      </div>{/* end grid */}
    </div>
      </main>
    </div>
  )
}
