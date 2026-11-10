'use client';

// Top navigation shared by every Vouch page (the dashboard shell renders the same links).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV = [
  { href: '/', label: 'Disputes', match: (p: string) => p === '/' || p.startsWith('/disputes') },
  { href: '/mandates', label: 'Mandates', match: (p: string) => p === '/mandates' || (p.startsWith('/mandates/') && p !== '/mandates/new') },
  { href: '/dashboard', label: 'Dashboard', match: (p: string) => p.startsWith('/dashboard') },
];

export function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${n.match(path) ? 'bg-pp-highlight text-pp-blue' : 'text-pp-navy hover:bg-pp-canvas'}`}
        >
          {n.label}
        </Link>
      ))}
      <Link href="/mandates/new" className="ml-2 rounded-full bg-pp-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-pp-blue-dark">
        + New mandate
      </Link>
    </nav>
  );
}

export function SiteNav() {
  return (
    <header className="border-b border-pp-border bg-white font-paypal">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <Link href="/" className="text-xl font-bold tracking-tight text-pp-navy">
          Vouch
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
