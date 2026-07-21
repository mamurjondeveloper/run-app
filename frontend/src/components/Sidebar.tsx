'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { motion } from 'framer-motion';
import { Home, Trophy, Footprints, LogOut, History, Map } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const links = [
    { name: 'Boshqaruv paneli', href: '/', icon: Home },
    { name: 'Reyting', href: '/leaderboard', icon: Trophy },
    { name: 'Tarix', href: '/history', icon: History },
    { name: 'Yugurish rejalashtirish', href: '/plan-run', icon: Map },
  ];

  return (
    <div className="hidden md:flex w-64 flex-col bg-black border-r border-border-dark p-6 h-screen select-none shrink-0 relative z-20">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(34,197,94,0.15)]">
          <Footprints className="h-5 w-5 text-primary" />
        </div>
        <span className="text-xl font-bold tracking-tight text-white">RunApp</span>
      </div>

      <nav className="space-y-1 flex-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link key={link.href} href={link.href} className="block group">
              <div
                className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 relative ${
                  isActive
                    ? 'text-primary font-medium bg-white/5'
                    : 'text-gray-400 group-hover:text-white group-hover:bg-white/2'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-indicator"
                    className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-sm">{link.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-border-dark pt-4 mt-4 flex items-center justify-between gap-3">
          <Link href="/profile" className="flex items-center gap-3 min-w-0 group">
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center border border-primary/20 shrink-0 text-sm font-bold text-primary overflow-hidden">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_URL}${user.avatarUrl}`} alt={user.username} className="h-full w-full object-cover" />
              ) : (
                user.username.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors">
                {user.username}
              </div>
              <div className="text-xs text-gray-400 truncate">Profilni ko'rish</div>
            </div>
          </Link>
          <button
            onClick={logout}
            className="p-2 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer shrink-0"
            title="Chiqish"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
