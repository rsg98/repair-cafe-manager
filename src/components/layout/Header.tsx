import React from 'react';
import { Wrench, LogIn, LogOut, Shield } from 'lucide-react';
import { cafeConfig } from '../../config/cafe.config';
import { Session } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useVolunteerPin } from '../../hooks/useVolunteerPin';
import { getAuthBannerState } from '../../utils/authUtils';

interface HeaderProps {
  session: Session | null;
  showAuthControls?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  showAuthControls = true,
}) => {
  // Resolve current Google Auth / custom token user and volunteer PIN state
  const { user, isAdmin, signInWithGoogle, signOut } = useAuth();
  const { isPinUnlocked } = useVolunteerPin(session);
  const bannerState = getAuthBannerState({ user, isAdmin, isPinUnlocked });
  const isAuthorizedRole =
    bannerState.role === 'ORGANIZER' || bannerState.role === 'VOLUNTEER';

  return (
    <header className="bg-emerald-800 text-white shadow-md sticky top-0 z-40 border-b border-emerald-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Cafe Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shadow-inner">
            <Wrench className="h-6 w-6 text-brand-300" aria-hidden="true" />
          </div>
          {/* Cafe title and desktop tagline */}
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
              {cafeConfig.cafeName}
            </h1>
            <p className="text-xs text-brand-200 hidden sm:block">
              {cafeConfig.tagline}
            </p>
          </div>
        </div>

        {/* Center: Session Status Pill (desktop viewports) */}
        <div className="hidden md:flex items-center gap-2 bg-emerald-900/60 px-3 py-1.5 rounded-full border border-emerald-700/60 text-xs">
          <span className={`h-2 w-2 rounded-full ${session ? 'bg-brand-400 animate-pulse' : 'bg-slate-400'}`} aria-hidden="true" />
          <span className="font-medium text-emerald-100">
            {session ? session.name : 'No Active Session'}
          </span>
          {/* Amber indicator when the active session is flagged as a test/rehearsal session */}
          {session?.isTest && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-400 text-amber-950 font-black text-[10px] uppercase tracking-wider">
              TEST
            </span>
          )}
        </div>

        {/* Mobile Test Session Indicator (visible on viewports where the center pill is hidden) */}
        {session?.isTest && (
          <div className="flex md:hidden items-center">
            <span className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 font-black text-[10px] uppercase tracking-wider shadow-sm">
              TEST
            </span>
          </div>
        )}

        {/* Right: Auth Controls (Organizer via Google Account or Volunteer via PIN) */}
        {showAuthControls && (
          <div className="flex items-center gap-3">
            {bannerState.role !== 'UNAUTHENTICATED' ? (
              <div className="flex items-center gap-2">
                {/* Active role status pill */}
                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border font-medium ${
                  isAuthorizedRole
                    ? 'bg-emerald-950/80 border-emerald-700 text-brand-200' 
                    : 'bg-amber-950/80 border-amber-700 text-amber-200'
                }`}>
                  <Shield className={`h-3.5 w-3.5 ${isAuthorizedRole ? 'text-brand-400' : 'text-amber-400'}`} aria-hidden="true" />
                  {bannerState.label}
                </span>
                {/* Sign-out button */}
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="Sign out"
                  title="Sign out"
                  className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              /* Organiser Google login button */
              <button
                type="button"
                onClick={signInWithGoogle}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white text-emerald-900 px-3 py-1.5 rounded-lg shadow-sm hover:bg-emerald-50 active:bg-emerald-100 transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Organiser Login</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

