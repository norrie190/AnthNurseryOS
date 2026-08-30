'use client';

import {
  CircleUserRound,
  Droplets,
  Gauge,
  Menu,
  Sprout,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import styles from './navigation.module.css';

type NavigationItem = Readonly<{
  href: string;
  label: string;
  icon: LucideIcon;
}>;

const navigationItems: readonly NavigationItem[] = [
  { href: '/', label: 'Dashboard', icon: Gauge },
  { href: '/plants', label: 'Plants', icon: Sprout },
  { href: '/care', label: 'Care', icon: Droplets },
  { href: '/equipment', label: 'Equipment', icon: Wrench },
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

  return (
    <nav className={styles.navigation} aria-label="Main navigation">
      {navigationItems.map(({ href, label, icon: Icon }) => {
        const isActive = href === '/' ? pathname === href : pathname.startsWith(href);

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
      })}
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

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <div className={styles.mobileNavigation}>
      <Brand />
      <button
        className={styles.menuButton}
        type="button"
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
          <aside className={styles.mobileMenu} id="mobile-navigation-panel">
            <div className={styles.mobileMenuHeader}>
              <Brand />
              <button
                className={styles.menuButton}
                type="button"
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
