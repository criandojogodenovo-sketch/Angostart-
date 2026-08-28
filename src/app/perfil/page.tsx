'use client';

/**
 * AngoStart — Perfil do utilizador.
 * Login simples com localStorage, preparado para ligar a uma API
 * de autenticação no futuro (os campos já coincidem com a tabela `users`).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Phone,
  ShoppingCart,
  Sparkles,
  User as UserIcon,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const USER_STORAGE_KEY = 'angostart.user.v1';

interface UserProfile {
  name: string;
  email: string;
  phone: string;
}

function readUser(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed?.name || !parsed?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function PerfilPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UserProfile>({ name: '', email: '', phone: '' });
  const { toast } = useToast();

  useEffect(() => {
    // Hidratação do perfil a partir do localStorage (evita mismatch SSR).
     
    const stored = readUser();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(stored);
     
    setForm(stored ?? { name: '', email: '', phone: '' });
     
    setReady(true);
  }, []);

  function handleSave(event: React.FormEvent) {
    event.preventDefault();

    if (form.name.trim().length < 3) {
      toast({ title: 'Nome incompleto', description: 'Escreve o teu nome completo (mínimo 3 letras).' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: 'Email inválido', description: 'Verifica o endereço de email que escreveste.' });
      return;
    }
    if (form.phone.trim().length < 9) {
      toast({ title: 'Telefone inválido', description: 'Indica pelo menos 9 dígitos, ex.: 923 456 789.' });
      return;
    }

    const profile: UserProfile = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    };
    try {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      /* armazenamento indisponível */
    }
    setUser(profile);
    setEditing(false);
    toast({
      title: editing ? 'Perfil guardado' : 'Perfil criado',
      description: `Bem-vindo(a), ${profile.name.split(' ')[0]}!`,
    });
  }

  function handleLogout() {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    setForm({ name: '', email: '', phone: '' });
    setEditing(false);
    toast({ title: 'Sessão terminada', description: 'O teu perfil foi removido deste dispositivo.' });
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <UserIcon className="mr-3 h-5 w-5 animate-pulse" />
        <span className="text-sm">A carregar o perfil…</span>
      </div>
    );
  }

  /* ─────────────── Utilizador autenticado ─────────────── */
  if (user && !editing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-brand-dark px-6 py-8 text-center text-white sm:px-10">
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-500/30">
              {initialsOf(user.name)}
            </span>
            <h1 className="mt-4 text-xl font-bold sm:text-2xl">{user.name}</h1>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-emerald-400">
              <BadgeCheck className="h-4 w-4" /> Membro AngoStart
            </p>
          </div>

          <div className="space-y-4 px-6 py-8 sm:px-10">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <Mail className="h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
                <p className="text-sm font-medium text-slate-800">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <Phone className="h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Telefone</p>
                <p className="text-sm font-medium text-slate-800">{user.phone || '—'}</p>
              </div>
            </div>

            <div className="grid gap-3 pt-2 sm:grid-cols-3">
              <Button
                onClick={() => setEditing(true)}
                className="h-11 bg-emerald-500 text-white hover:bg-emerald-600"
              >
                <Pencil className="mr-2 h-4 w-4" /> Editar
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
              >
                <Link href="/carrinho">
                  <ShoppingCart className="mr-2 h-4 w-4" /> Carrinho
                </Link>
              </Button>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sair
              </Button>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>
                O teu perfil fica guardado neste dispositivo e já preenche os
                dados do carrinho. Em breve vais poder ver aqui o histórico de
                encomendas — a base de dados já está preparada para isso.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── Formulário (criar/editar perfil) ─────────────── */
  const isEditingExisting = !!user && editing;
  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
            {isEditingExisting ? <Pencil className="h-6 w-6" /> : <UserRound className="h-7 w-7" />}
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {isEditingExisting ? 'Editar perfil' : 'Cria o teu perfil AngoStart'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {isEditingExisting
              ? 'Atualiza os teus dados e guarda as alterações.'
              : 'Guarda os teus dados para finalizar compras mais rápido. Fica no teu dispositivo, sem passwords.'}
          </p>
        </div>

        <form onSubmit={handleSave} className="mt-8 space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="perfil-nome">Nome completo</Label>
            <Input
              id="perfil-nome"
              type="text"
              autoComplete="name"
              placeholder="Ex.: Ana Kiala"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="perfil-email">Email</Label>
            <Input
              id="perfil-email"
              type="email"
              autoComplete="email"
              placeholder="ana@exemplo.ao"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="perfil-telefone">Telefone / WhatsApp</Label>
            <Input
              id="perfil-telefone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="923 456 789"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <Button
            type="submit"
            className="h-12 w-full bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600"
          >
            <LogIn className="mr-2 h-5 w-5" />
            {isEditingExisting ? 'Guardar alterações' : 'Entrar / Criar perfil'}
          </Button>

          {isEditingExisting && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              className="h-11 w-full"
            >
              Cancelar
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
