'use client';

import {
  CircleUserRound,
  Droplets,
  Gauge,
  HeartHandshake,
  Menu,
  Sprout,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import styles from './navigation.module.css';

type NavigationItem = Readonly<{
  href: string;
  label: string;
  icon: LucideIcon;
}>;

const primaryNavigation: readonly NavigationItem[] = [
  { href: '/', label: 'Dashboard', icon: Gauge },
  { href: '/plants', label: 'Plants', icon: Sprout },
  { href: '/watering', label: 'Watering', icon: Droplets },
  { href: '/breeding', label: 'Breeding', icon: HeartHandshake },
  { href: '/equipment', label: 'Equipment', icon: Wrench },
];

const secondaryNavigation: readonly NavigationItem[] = [
  { href: '/energy/tariffs', label: 'Energy', icon: Gauge },
  { href: '/expenses', label: 'Expenses', icon: WalletCards },
];

function Brand() {
  return (
    <Link className={styles.brand} href="/" aria-label="Anth Nursery OS dashboard">
      <span className={styles.brandMark} aria-hidden="true">
        <Sprout size={25} strokeWidth={1.65} />
      </span>
      <span>
        <strong>Anth Nursery</strong>
        <small>Nursery OS</small>
      </span>
    </Link>
  );
}

function NavigationLinks({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  const pathname = usePathname();

  function renderLinks(items: readonly NavigationItem[]) {
    return items.map(({ href, label, icon: Icon }) => {
      const isActive =
        href === '/'
          ? pathname === href
          : pathname.startsWith(href.split('/').slice(0, 2).join('/'));

      return (
        <Link
          className={`${styles.navigationLink} ${isActive ? styles.activeLink : ''}`}
          href={href}
          aria-current={isActive ? 'page' : undefined}
          key={href}
          onClick={onNavigate}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
          <span>{label}</span>
        </Link>
      );
    });
  }

  return (
    <nav className={styles.navigation} aria-label="Main navigation">
      <div className={styles.navigationGroup}>
        <span className={styles.groupLabel}>Operations</span>
        {renderLinks(primaryNavigation)}
      </div>
      <div className={styles.navigationGroup}>
        <span className={styles.groupLabel}>Workspace</span>
        {renderLinks(secondaryNavigation)}
      </div>
    </nav>
  );
}

function NurseryProfile() {
  return (
    <div className={styles.profile}>
      <CircleUserRound aria-hidden="true" size={34} strokeWidth={1.4} />
      <span>
        <strong>My Nursery</strong>
        <small>Owner</small>
      </span>
    </div>
  );
}

export function DesktopNavigation() {
  return (
    <aside className={styles.sidebar}>
      <Brand />
      <NavigationLinks />
      <NurseryProfile />
    </aside>
  );
}

export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  function closeMenu() {
    setIsOpen(false);
    queueMicrotask(() => menuButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeMenu();
        return;
      }

      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div className={styles.mobileNavigation}>
      <Brand />
      <button
        className={styles.menuButton}
        type="button"
        ref={menuButtonRef}
        aria-controls="mobile-navigation-panel"
        aria-expanded={isOpen}
        aria-label="Open navigation"
        onClick={() => setIsOpen(true)}
      >
        <Menu aria-hidden="true" size={22} />
      </button>

      {isOpen ? (
        <div className={styles.mobileMenuLayer}>
          <button
            className={styles.backdrop}
            type="button"
            aria-label="Close navigation"
            onClick={closeMenu}
          />
          <aside
            className={styles.mobileMenu}
            id="mobile-navigation-panel"
            ref={menuRef}
            aria-label="Navigation menu"
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.mobileMenuHeader}>
              <Brand />
              <button
                className={styles.menuButton}
                type="button"
                ref={closeButtonRef}
                aria-label="Close navigation"
                onClick={closeMenu}
              >
                <X aria-hidden="true" size={22} />
              </button>
            </div>
            <NavigationLinks onNavigate={closeMenu} />
            <NurseryProfile />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
