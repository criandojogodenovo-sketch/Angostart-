'use client';

/**
 * AngoStart — Contexto de autenticação multi-perfil
 *
 * - Guarda o JWT em localStorage e restaura a sessão ao carregar a app
 *   (token → GET /api/auth/me).
 * - registerCliente / registerVendedor / login / logout.
 * - `isSeller` facilita às UIs mostrar/ocultar ações de vendedor.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Role } from '@/lib/roles';

/* Tipo espelho do AuthUser server-side (sem imports de servidor no cliente) */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  username: string | null;
  telefone: string | null;
  bio: string | null;
  area_atuacao: string | null;
  cidade: string | null;
  especialidade: string | null;
  portfolio_url: string | null;
  blocked: boolean;
  /** Fase 9: TRUE → deve trocar a senha antes de continuar. */
  must_change_password?: boolean;
  kyc_status?: string | null;
  is_verified_bi?: boolean;
}

const SELLER_ROLES: Role[] = ['criador', 'prestador_domicilio', 'prestador_remoto'];

export function isSellerRole(role: Role | undefined | null): boolean {
  return !!role && SELLER_ROLES.includes(role);
}

const TOKEN_KEY = 'angostart.token.v1';
const USER_KEY = 'angostart.auth.user.v1';

export interface RegisterClienteData {
  name: string;
  email: string;
  password: string;
  telefone: string;
  /** Fase 9: código de afiliado que indicou a conta (opcional). */
  ref_code?: string;
}

export interface RegisterVendedorData {
  name: string;
  email: string;
  password: string;
  telefone: string;
  role: Exclude<Role, 'cliente'>;
  bio?: string;
  area_atuacao?: string;
  cidade?: string;
  especialidade?: string;
  portfolio_url?: string;
  /** Fase 9: BI opcional (formato angolano) — validado se preenchido. */
  bi_number?: string;
  /** Fase 12: data de nascimento opcional (AAAA-MM-DD, idade mínima 15). */
  birth_date?: string;
  /** Fase 12: foto do documento KYC (URL do /api/kyc/upload) — opcional. */
  kyc_document_url?: string;
  /** Fase 12: tipo do documento ('bi' | 'passaporte' | 'cartao_eleitor'). */
  kyc_document_type?: string;
  /** Fase 9: código de afiliado que indicou a conta (opcional). */
  ref_code?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean; // true enquanto restaura a sessão
  isSeller: boolean;
  registerCliente: (data: RegisterClienteData) => Promise<AuthUser>;
  registerVendedor: (data: RegisterVendedorData) => Promise<AuthUser>;
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Sessão já obtida (login por código diário/convite) — persiste token+user. */
  applySession: (token: string, user: AuthUser) => AuthUser;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Lê o token JWT guardado (só no cliente) para chamadas autenticadas. */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function persistSession(token: string, user: AuthUser) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* armazenamento indisponível — ignora */
  }
}

function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* armazenamento indisponível — ignora */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaura a sessão ao carregar a app: token → /api/auth/me
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let token: string | null = null;
      try {
        token = window.localStorage.getItem(TOKEN_KEY);
      } catch {
        token = null;
      }

      if (!token) {
         
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('sessão inválida');
        const data = (await res.json()) as { user: AuthUser };
        if (cancelled) return;
         
        setUser(data.user);
        persistSession(token, data.user); // refresca a cópia local
      } catch {
        if (cancelled) return;
        clearSession();
         
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const registerCliente = useCallback(async (data: RegisterClienteData) => {
    const res = await fetch('/api/auth/register/cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = (await res.json()) as { token?: string; user?: AuthUser; error?: string };
    if (!res.ok || !payload.token || !payload.user) {
      throw new Error(payload.error || 'Não foi possível criar a conta.');
    }
    persistSession(payload.token, payload.user);
    setUser(payload.user);
    return payload.user;
  }, []);

  const registerVendedor = useCallback(async (data: RegisterVendedorData) => {
    const res = await fetch('/api/auth/register/vendedor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = (await res.json()) as { token?: string; user?: AuthUser; error?: string };
    if (!res.ok || !payload.token || !payload.user) {
      throw new Error(payload.error || 'Não foi possível criar a conta.');
    }
    persistSession(payload.token, payload.user);
    setUser(payload.user);
    return payload.user;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const payload = (await res.json()) as { token?: string; user?: AuthUser; error?: string };
    if (!res.ok || !payload.token || !payload.user) {
      throw new Error(payload.error || 'Email ou palavra-passe incorretos.');
    }
    persistSession(payload.token, payload.user);
    setUser(payload.user);
    return payload.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  /** Persiste uma sessão já criada no servidor (login por código). */
  const applySession = useCallback((token: string, nextUser: AuthUser) => {
    persistSession(token, nextUser);
    setUser(nextUser);
    return nextUser;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isSeller: isSellerRole(user?.role),
      registerCliente,
      registerVendedor,
      login,
      applySession,
      logout,
    }),
    [user, loading, registerCliente, registerVendedor, login, applySession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}

/** Headers com o token guardado — útil para chamadas autenticadas noutras páginas. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
