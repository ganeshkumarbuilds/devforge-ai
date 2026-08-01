import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Lock, SlidersHorizontal, Cpu, KeyRound, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../api/auth';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { cn } from '../lib/utils';

const STACK_OPTIONS = ['Auto', 'React + Express', 'Next.js + Prisma', 'TypeScript Full Stack'];
const THEME_OPTIONS = ['Dark', 'Light'];

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();

  const initialSettings = user?.settings || {};
  const [defaultStack, setDefaultStack] = useState(initialSettings.defaultStack || '');
  const [theme, setTheme] = useState(initialSettings.theme || 'dark');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState({});

  const saveSettings = async () => {
    setSaving(true);
    try {
      const data = await authApi.updateSettings({ defaultStack, theme });
      await refreshUser();
      toast.success('Settings saved', 'Your preferences were updated.');
      return data;
    } catch (err) {
      toast.error('Save failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!currentPassword) errors.currentPassword = 'Enter your current password';
    if (newPassword.length < 8) errors.newPassword = 'New password must be at least 8 characters';
    if (newPassword !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setPasswordErrors(errors);
    if (Object.keys(errors).length) return;

    setChangingPassword(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed', 'All your sessions were signed out. Please sign in again.');
    } catch (err) {
      toast.error('Password change failed', err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-extrabold text-white sm:text-3xl">
          <Settings className="h-7 w-7 text-accent-soft" />
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-400">Configure your workspace preferences and account security.</p>
      </div>

      {/* Preferences */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-soft">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold text-white">Preferences</h2>
              <p className="text-xs text-slate-400">Defaults used when generating new projects.</p>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <p className="label-field">Default tech stack</p>
              <div className="flex flex-wrap gap-2">
                {STACK_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDefaultStack(s === 'Auto' ? '' : s)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200',
                      (s === 'Auto' && !defaultStack) || defaultStack === s
                        ? 'border-accent/60 bg-accent/15 text-accent-soft'
                        : 'border-white/10 bg-base-800/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    )}
                  >
                    {((s === 'Auto' && !defaultStack) || defaultStack === s) && <Check className="h-3.5 w-3.5" />}
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label-field">Theme</p>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t.toLowerCase())}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200',
                      theme === t.toLowerCase()
                        ? 'border-accent/60 bg-accent/15 text-accent-soft'
                        : 'border-white/10 bg-base-800/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    )}
                  >
                    {theme === t.toLowerCase() && <Check className="h-3.5 w-3.5" />}
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
              <Button onClick={saveSettings} loading={saving}>
                <Check className="h-4 w-4" /> Save settings
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Security */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold text-white">Change password</h2>
              <p className="text-xs text-slate-400">Signing in on other devices will require the new password.</p>
            </div>
          </div>

          <form onSubmit={changePassword} className="space-y-5">
            <Input
              id="current-password"
              label="Current password"
              type="password"
              placeholder="Your current password"
              icon={KeyRound}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              error={passwordErrors.currentPassword}
              autoComplete="current-password"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                id="new-password"
                label="New password"
                type="password"
                placeholder="At least 8 characters"
                icon={KeyRound}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={passwordErrors.newPassword}
                autoComplete="new-password"
              />
              <Input
                id="confirm-password"
                label="Confirm new password"
                type="password"
                placeholder="Repeat new password"
                icon={KeyRound}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={passwordErrors.confirmPassword}
                autoComplete="new-password"
              />
            </div>
            <div className="flex justify-end border-t border-white/[0.06] pt-5">
              <Button type="submit" variant="secondary" loading={changingPassword}>
                <Cpu className="h-4 w-4" /> Update password
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
