'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Trophy, User, History, Map } from 'lucide-react';

export default function MobileNav() {
  const pathname = usePathname();

  const tabs = [
    { name: 'Bosh', href: '/', icon: Home },
    { name: 'Reyting', href: '/leaderboard', icon: Trophy },
    { name: 'Tarix', href: '/history', icon: History },
    { name: 'Reja', href: '/plan-run', icon: Map },
    { name: 'Profil', href: '/profile', icon: User },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-black/95 backdrop-blur-lg border-t border-border-dark flex items-center justify-around px-1 z-40 select-none">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex flex-col items-center justify-center gap-1 flex-1 min-w-0 py-1"
          >
            <Icon
              className={`h-[22px] w-[22px] transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400'
              }`}
            />
            <span
              className={`text-[10px] transition-colors ${
                isActive ? 'text-primary font-medium' : 'text-gray-400'
              }`}
            >
              {tab.name}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
