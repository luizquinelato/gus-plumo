import React, { useRef, useState } from 'react'
import { User, Lock, Save, Eye, EyeOff, Camera, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
function getAvatarUrl(path: string | undefined | null): string | null {
  if (!path) return null
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`
}

const inputCls = [
  'w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all',
  'border border-gray-200 dark:border-gray-600',
  'bg-white dark:bg-gray-700',
  'text-gray-800 dark:text-gray-100',
  'placeholder-gray-400 dark:placeholder-gray-500',
  'focus:border-[var(--color-1)] focus:ring-2 focus:ring-[var(--color-1)]/20',
].join(' ')

const sectionTitle = 'flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-5'

const AVATAR_SIZE = 120

export default function ProfilePage() {
  const { user, updateUser } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [firstName,    setFirstName]    = useState(user?.primeiro_nome ?? '')
  const [lastName,     setLastName]     = useState(user?.ultimo_nome ?? '')
  const [currentPass,  setCurrentPass]  = useState('')
  const [newPass,      setNewPass]      = useState('')
  const [confirmPass,  setConfirmPass]  = useState('')
  const [showCurrent,  setShowCurrent]  = useState(false)
  const [showNew,      setShowNew]      = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [loadingName,  setLoadingName]  = useState(false)
  const [loadingPass,  setLoadingPass]  = useState(false)
  const [loadingAvatar,setLoadingAvatar]= useState(false)
  const [avatarHov,    setAvatarHov]    = useState(false)
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' | 'warning' }>({ show: false, message: '', type: 'success' })

  const initials = user?.nome
    ? user.nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('')
    : '?'

  const avatarUrl = getAvatarUrl(user?.avatar_url)

  function flash(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    setToast({ show: true, message: msg, type })
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadingAvatar(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/api/users/me/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      updateUser({ avatar_url: data.avatar_url })
      flash('Foto atualizada com sucesso!')
    } catch {
      flash('Erro ao enviar a foto.', 'error')
    } finally {
      setLoadingAvatar(false)
      e.target.value = ''
    }
  }

  async function handleRemoveAvatar() {
    setLoadingAvatar(true)
    try {
      await axios.delete('/api/users/me/avatar')
      updateUser({ avatar_url: undefined })
      flash('Foto removida.')
    } catch {
      flash('Erro ao remover a foto.', 'error')
    } finally {
      setLoadingAvatar(false)
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setLoadingName(true)
    try {
      const { data } = await axios.patch('/api/users/me', { first_name: firstName, last_name: lastName })
      updateUser({
        primeiro_nome: data.first_name ?? '',
        ultimo_nome: data.last_name ?? '',
        nome: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim(),
      })
      flash('Dados atualizados com sucesso!')
    } catch {
      flash('Erro ao salvar os dados.', 'error')
    } finally {
      setLoadingName(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPass) return flash('Informe a senha atual.', 'error')
    if (newPass !== confirmPass) return flash('Nova senha e confirmação não coincidem.', 'error')
    if (newPass.length < 6) return flash('A nova senha deve ter pelo menos 6 caracteres.', 'error')
    setLoadingPass(true)
    try {
      await axios.patch('/api/users/me/password', { current_password: currentPass, new_password: newPass })
      setCurrentPass(''); setNewPass(''); setConfirmPass('')
      flash('Senha alterada com sucesso!')
    } catch {
      flash('Senha atual incorreta.', 'error')
    } finally {
      setLoadingPass(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 space-y-6">

          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Perfil</h1>

          {toast.show && (
            <Toast
              message={toast.message}
              type={toast.type}
              onClose={() => setToast(t => ({ ...t, show: false }))}
            />
          )}

          {/* ── Dados ── */}
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
            <p className={sectionTitle}><User size={13} />Dados</p>

            {/* Avatar */}
            <div className="flex items-center gap-6 mb-7">
              {/* Círculo clicável */}
              <div
                style={{ position: 'relative', width: AVATAR_SIZE, height: AVATAR_SIZE, flexShrink: 0, cursor: loadingAvatar ? 'wait' : 'pointer' }}
                onClick={() => !loadingAvatar && fileInputRef.current?.click()}
                onMouseEnter={() => setAvatarHov(true)}
                onMouseLeave={() => setAvatarHov(false)}
              >
                <div style={{
                  width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: '50%', overflow: 'hidden',
                  background: 'var(--gradient-1-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '3px solid var(--color-1)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                }}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ color: 'var(--on-gradient-1-2)', fontWeight: 700, fontSize: 42, userSelect: 'none' }}>{initials}</span>
                  }
                </div>
                {/* Overlay hover / loading */}
                {(avatarHov || loadingAvatar) && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {loadingAvatar
                      ? <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Camera size={34} color="white" />
                    }
                  </div>
                )}
              </div>

              {/* Legenda + remover */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Foto de perfil</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {avatarUrl ? 'Clique na foto para trocar' : 'Clique na foto para adicionar uma imagem'}
                </p>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={loadingAvatar}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-transparent border-none p-0 cursor-pointer w-fit text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 size={13} />
                    Remover foto
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>

            {/* Formulário de dados */}
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
                <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={user?.is_admin ? 'Administrador' : 'Usuário'} disabled />
              </div>
              <div className="flex justify-end pt-1">
                <button type="submit" disabled={loadingName}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-white transition-opacity"
                  style={{ background: 'var(--gradient-1-2)', opacity: loadingName ? 0.7 : 1, cursor: loadingName ? 'not-allowed' : 'pointer' }}>
                  <Save size={14} />{loadingName ? 'Salvando...' : 'Salvar Dados'}
                </button>
              </div>
            </form>
          </section>

          {/* ── Segurança ── */}
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
            <p className={sectionTitle}><Lock size={13} />Segurança</p>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Senha Atual</label>
                <div className="relative">
                  <input type={showCurrent ? 'text' : 'password'} autoComplete="current-password"
                    className={`${inputCls} pr-11`} value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Digite sua senha atual" />
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowCurrent(p => !p)}
                    tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                    {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Nova Senha</label>
                <div className="relative">
                  <input type={showNew ? 'text' : 'password'} autoComplete="new-password"
                    className={`${inputCls} pr-11`} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mínimo 6 caracteres" />
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowNew(p => !p)}
                    tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Confirmar Nova Senha</label>
                <div className="relative">
                  <input type={showConfirm ? 'text' : 'password'} autoComplete="new-password"
                    className={`${inputCls} pr-11 ${confirmPass && newPass !== confirmPass ? 'border-red-400 focus:border-red-400' : ''}`}
                    value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repita a nova senha" />
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setShowConfirm(p => !p)}
                    tabIndex={-1} className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirmPass && newPass !== confirmPass && (
                  <p className="mt-1 text-xs text-red-500">As senhas não coincidem</p>
                )}
              </div>
              <div className="flex justify-end pt-1">
                <button type="submit" disabled={loadingPass}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-white transition-opacity"
                  style={{ background: 'var(--gradient-1-2)', opacity: loadingPass ? 0.7 : 1, cursor: loadingPass ? 'not-allowed' : 'pointer' }}>
                  <Lock size={14} />{loadingPass ? 'Alterando...' : 'Alterar Senha'}
                </button>
              </div>
            </form>
          </section>

        </div>
      </main>
    </div>
  )
}
