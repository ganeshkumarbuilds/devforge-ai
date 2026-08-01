import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { UserCircle, Save, Monitor, Smartphone, Globe, XCircle, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../api/auth';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { formatDate, formatDateTime } from '../lib/utils';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    authApi
      .sessions()
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, []);

  const initials = (user?.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      await authApi.updateProfile({ name: name.trim() });
      await refreshUser();
      toast.success('Profile updated', 'Your name was saved.');
    } catch (err) {
      toast.error('Update failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const revokeSession = async (_sessionId) => {
    // Server exposes logout via x-session-token; for other sessions we keep this
    // simple and just refresh the list after revoking via the current session.
    toast.info('Session management', 'Revoking other sessions requires signing out on that device.');
  };

  const deviceIcon = (ua) => {
    const u = (ua || '').toLowerCase();
    if (u.includes('iphone') || u.includes('ipad') || u.includes('android')) return <Smartphone className="h-4 w-4" />;
    if (u.includes('mac') || u.includes('windows') || u.includes('linux')) return <Monitor className="h-4 w-4" />;
    return <Globe className="h-4 w-4" />;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-extrabold text-white sm:text-3xl">
          <UserCircle className="h-7 w-7 text-accent-soft" />
          Profile
        </h1>
        <p className="mt-1 text-sm text-slate-400">Manage your personal information and active sessions.</p>
      </div>

      {/* Profile card */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-600 text-xl font-bold text-white shadow-lg shadow-accent/30">
              {initials}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{user?.name}</h2>
              <p className="text-sm text-slate-400">{user?.email}</p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <Input
              id="profile-name"
              label="Display name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              id="profile-email"
              label="Email"
              value={user?.email || ''}
              disabled
              className="opacity-60"
            />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl border border-white/[0.06] bg-base-900/50 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Member since</p>
                <p className="mt-1 font-semibold text-white">{formatDate(user?.createdAt)}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-base-900/50 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Projects</p>
                <p className="mt-1 font-semibold text-white">{user?.projectCount ?? 0}</p>
              </div>
            </div>
            <div className="flex justify-end border-t border-white/[0.06] pt-5">
              <Button onClick={saveProfile} loading={saving}>
                <Save className="h-4 w-4" /> Save profile
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Sessions */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white">Active sessions</h2>
              <p className="text-xs text-slate-400">Devices currently signed into your account.</p>
            </div>
            <Badge tone="blue">{sessions.length} active</Badge>
          </div>

          {sessionsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 animate-shimmer rounded-xl bg-gradient-to-r from-base-700 via-base-600 to-base-700 bg-[length:200%_100%]" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <LogIn className="h-6 w-6 text-slate-600" />
              <p className="text-sm text-slate-400">No active sessions found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-base-900/50 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-base-800 text-slate-400">
                      {deviceIcon(session.userAgent)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {session.userAgent ? session.userAgent.split('(')[0].trim().slice(0, 60) : 'Unknown device'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {session.ip || 'Unknown IP'} · Last seen {formatDateTime(session.lastSeen)}
                      </p>
                    </div>
                  </div>
                  {session.revokedAt ? (
                    <Badge tone="red">Revoked</Badge>
                  ) : (
                    <button
                      onClick={() => revokeSession(session.id)}
                      className="shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                      title="Revoke session"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
