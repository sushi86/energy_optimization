'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Blinds,
  Wind,
  Flame,
  Sun,
  Settings,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface NavItem {
  label: string;
  href: string | null;
  icon: LucideIcon;
  prominent?: boolean;
}

// Mobile order: Dashboard prominent in the middle.
const MOBILE_NAV_ITEMS: NavItem[] = [
  { label: 'Verschattung', href: '/verschattung', icon: Blinds },
  { label: 'Belüftung', href: null, icon: Wind },
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, prominent: true },
  { label: 'Wärme', href: null, icon: Flame },
  { label: 'Solar', href: '/solar', icon: Sun },
];

// Desktop order: Dashboard first (far left).
const DESKTOP_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Verschattung', href: '/verschattung', icon: Blinds },
  { label: 'Belüftung', href: null, icon: Wind },
  { label: 'Wärme', href: null, icon: Flame },
  { label: 'Solar', href: '/solar', icon: Sun },
];

function isActive(pathname: string, href: string | null): boolean {
  if (!href) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5 items-end h-16">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const disabled = item.href === null;
          const Icon = item.icon;

          if (item.prominent) {
            return (
              <li key={item.label} className="flex justify-center">
                <Link
                  href={item.href ?? '#'}
                  aria-current={active ? 'page' : undefined}
                  className={`-mt-5 flex flex-col items-center justify-center w-16 h-16 rounded-full border shadow-lg transition-colors ${
                    active
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-black'
                      : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={22} />
                  <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
                </Link>
              </li>
            );
          }

          const baseClasses =
            'flex flex-col items-center justify-center gap-1 h-full py-2 transition-colors';
          const stateClasses = disabled
            ? 'text-[var(--text-secondary)]/40 pointer-events-none'
            : active
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

          return (
            <li key={item.label} className="flex">
              {disabled ? (
                <span className={`${baseClasses} ${stateClasses} flex-1`} aria-disabled="true">
                  <Icon size={20} />
                  <span className="text-[10px]">{item.label}</span>
                </span>
              ) : (
                <Link
                  href={item.href!}
                  aria-current={active ? 'page' : undefined}
                  className={`${baseClasses} ${stateClasses} flex-1`}
                >
                  <Icon size={20} />
                  <span className="text-[10px]">{item.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function DesktopNavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {DESKTOP_NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const disabled = item.href === null;
        const Icon = item.icon;

        const base =
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
        const state = disabled
          ? 'text-[var(--text-secondary)]/40 cursor-not-allowed'
          : active
            ? 'bg-[var(--bg-card)] text-[var(--accent)] border border-[var(--accent)]/30'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent';

        if (disabled) {
          return (
            <span key={item.label} className={`${base} ${state}`} aria-disabled="true">
              <Icon size={16} />
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.label}
            href={item.href!}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={`${base} ${state}`}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function DesktopNav({ pathname }: { pathname: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close burger when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const settingsActive = isActive(pathname, '/settings');

  return (
    <header className="hidden md:flex fixed top-0 inset-x-0 z-40 h-14 items-center justify-between px-4 border-b border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur">
      {/* Left: full nav on lg+, burger on md */}
      <div className="flex items-center gap-1">
        <span className="font-bold tracking-tight mr-3">Energy Control</span>
        <nav className="hidden lg:flex items-center gap-1">
          <DesktopNavLinks pathname={pathname} />
        </nav>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="lg:hidden flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent cursor-pointer"
          aria-expanded={menuOpen}
          aria-label="Menü"
        >
          {menuOpen ? <X size={16} /> : <Menu size={16} />}
          Menü
        </button>
      </div>

      {/* Right: settings */}
      <Link
        href="/settings"
        aria-current={settingsActive ? 'page' : undefined}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          settingsActive
            ? 'bg-[var(--bg-card)] text-[var(--accent)] border border-[var(--accent)]/30'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent'
        }`}
      >
        <Settings size={16} />
        Einstellungen
      </Link>

      {/* Burger dropdown (md, below lg) */}
      {menuOpen && (
        <div className="lg:hidden absolute top-14 left-0 right-0 border-b border-[var(--border)] bg-[var(--bg-primary)]/98 backdrop-blur p-3 flex flex-col gap-1">
          <DesktopNavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
        </div>
      )}
    </header>
  );
}

export function NavBar() {
  const pathname = usePathname() ?? '/';
  return (
    <>
      <DesktopNav pathname={pathname} />
      <MobileNav pathname={pathname} />
    </>
  );
}
