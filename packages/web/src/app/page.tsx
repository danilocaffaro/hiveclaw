'use client';

import { useState, useEffect } from 'react';
import { SetupWizard } from '@/components/SetupWizard';
import { ChatApp } from '@/components/ChatApp';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [setupDone, setSetupDone] = useState(false);

  useEffect(() => {
    fetch(`${API}/setup/status`)
      .then(r => r.json())
      .then(d => { setSetupDone(d.setupComplete); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!setupDone) {
    return <SetupWizard onComplete={() => setSetupDone(true)} />;
  }

  return <ChatApp />;
}
