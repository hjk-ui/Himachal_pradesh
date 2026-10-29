'use client';

import { useState } from 'react';
import { useAuth } from '@/features/auth';

export function AdminVendorLink({ screen }: { screen: 'message' | 'report' }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  if (user?.role !== 'ADMIN') return null;

  async function openVendor() {
    setMessage('');
    const response = await fetch('/api/integrations/drfirst/admin-launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.launchUrl) {
      setMessage(data.error || 'The vendor did not open.');
      return;
    }
    window.location.assign(data.launchUrl);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <button type="button" onClick={() => void openVendor()} className="text-sm font-semibold text-[#5C2D91]">
        Open vendor {screen === 'message' ? 'messages' : 'reports'}
      </button>
      <p className="text-xs text-slate-500">Uses your own username on this screen only.</p>
      {message ? <p className="text-xs text-slate-700">{message}</p> : null}
    </div>
  );
}
