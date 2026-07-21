'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useToastStore } from '@/store/toastStore';
import { Button, Input } from '@/components/ui';
import api from '@/services/api';
import { isAxiosError } from 'axios';
import { User as UserIcon, Lock, Camera, Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message;
  }
  return fallback;
}

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const showToast = useToastStore((state) => state.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(user?.username || '');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the editable field from the auth store once the user loads/changes
    setUsername(user?.username || '');
  }, [user?.username]);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const formData = new FormData();
    formData.append('file', file);

    setIsUploadingAvatar(true);
    try {
      const res = await api.post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      updateUser(res.data);
      showToast('Profile photo updated!', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to upload photo'), 'error');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || username === user?.username) return;
    setIsSavingUsername(true);
    try {
      const res = await api.patch('/auth/profile', { username: username.trim() });
      updateUser(res.data);
      showToast('Username updated!', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update username'), 'error');
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }
    setIsSavingPassword(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      showToast('Password changed successfully!', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to change password'), 'error');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Profile</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your account and security</p>
      </div>

      <div className="glass-panel p-6 rounded-3xl space-y-6">
        <div className="flex items-center gap-5">
          <button
            onClick={handleAvatarClick}
            className="relative h-20 w-20 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden group cursor-pointer"
            title="Change photo"
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${user.avatarUrl}`} alt={user.username} className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-primary">{user.username.slice(0, 2).toUpperCase()}</span>
            )}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {isUploadingAvatar ? (
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              ) : (
                <Camera className="h-5 w-5 text-white" />
              )}
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <div>
            <div className="text-lg font-bold text-white">{user.username}</div>
            <div className="text-xs text-gray-400 mt-0.5">Click your photo to change it</div>
          </div>
        </div>

        <form onSubmit={handleSaveUsername} className="flex items-end gap-3">
          <Input
            label="Username"
            icon={<UserIcon className="h-4 w-4" />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
          />
          <Button
            type="submit"
            variant="secondary"
            isLoading={isSavingUsername}
            disabled={!username.trim() || username === user.username}
            className="shrink-0"
          >
            Save
          </Button>
        </form>
      </div>

      <div className="glass-panel p-6 rounded-3xl space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" /> Change Password
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            isLoading={isSavingPassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Update Password
          </Button>
        </form>
      </div>
    </div>
  );
}
