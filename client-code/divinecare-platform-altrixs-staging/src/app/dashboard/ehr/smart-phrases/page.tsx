'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Lock, Pencil, Plus, Search, Trash2, Users, User, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  SMART_PHRASES,
  SMART_PHRASE_CATEGORIES,
  SMART_PHRASE_LIMITS,
  findUnfilledBlanks,
  smartPhraseKeyError,
} from '@/lib/ehr/smartPhrases';
import { SmartPhraseTextarea, useSmartPhrases } from '@/components/notes/SmartPhraseTextarea';
import { PageHeader, buttonClasses, Alert } from '@/components/ui';

type CustomPhrase = {
  id: string;
  key: string;
  label: string;
  text: string;
  category: string | null;
  mine: boolean;
  shared: boolean;
  updatedAt: string;
};

type FormState = {
  id: string | null;
  key: string;
  label: string;
  category: string;
  text: string;
  shared: boolean;
};

const EMPTY_FORM: FormState = { id: null, key: '.', label: '', category: '', text: '', shared: false };
const BUILT_IN_KEYS = new Set(SMART_PHRASES.map((p) => p.key));

/** Phrase text with [___] blanks highlighted */
function PhrasePreview({ text }: { text: string }) {
  const parts = text.split(/(\[_{2,}\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
      {parts.map((part, i) =>
        /^\[_{2,}\]$/.test(part) ? (
          <span key={i} className="rounded bg-amber-100 px-1 font-mono text-amber-800">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

function KeyBadge({ value }: { value: string }) {
  return (
    <code className="rounded-md bg-blue-600/10 px-2 py-0.5 font-mono text-xs font-semibold text-blue-600">
      {value}
    </code>
  );
}

export default function SmartPhrasesPage() {
  const { reload } = useSmartPhrases();
  const [custom, setCustom] = useState<CustomPhrase[]>([]);
  const [canManageShared, setCanManageShared] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [tryText, setTryText] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiJson<{ success: true; phrases: CustomPhrase[]; canManageShared?: boolean }>(
        '/api/smart-phrases'
      );
      setCustom(data.phrases || []);
      setCanManageShared(Boolean(data.canManageShared));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your phrases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const q = query.trim().toLowerCase();
  const matches = (p: { key: string; label: string; text: string; category?: string | null }) =>
    !q ||
    p.key.includes(q) ||
    p.label.toLowerCase().includes(q) ||
    (p.category ?? '').toLowerCase().includes(q) ||
    p.text.toLowerCase().includes(q);

  const mine = custom.filter((p) => p.mine && matches(p));
  const shared = custom.filter((p) => p.shared && matches(p));
  const builtIns = SMART_PHRASES.filter(matches);
  const overriddenKeys = useMemo(() => new Set(custom.map((p) => p.key)), [custom]);

  function startEdit(p: CustomPhrase) {
    setFormError(null);
    setForm({ id: p.id, key: p.key, label: p.label, category: p.category ?? '', text: p.text, shared: p.shared });
  }

  function startFromBuiltIn(p: (typeof SMART_PHRASES)[number]) {
    setFormError(null);
    setForm({ id: null, key: p.key, label: p.label, category: p.category, text: p.text, shared: false });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const key = form.key.trim().toLowerCase();
    const keyError = smartPhraseKeyError(key);
    if (keyError) return setFormError(keyError);
    if (!form.label.trim()) return setFormError('Label is required');
    if (!form.text.trim()) return setFormError('Phrase text is required');

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        key,
        label: form.label.trim(),
        text: form.text.trim(),
        category: form.category.trim() || null,
      };
      if (form.id) {
        await apiJson(`/api/smart-phrases/${encodeURIComponent(form.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson('/api/smart-phrases', {
          method: 'POST',
          body: JSON.stringify({ ...payload, shared: form.shared }),
        });
      }
      setForm(null);
      await load();
      reload();
      flash(form.id ? 'Phrase updated' : 'Phrase created');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the phrase');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: CustomPhrase) {
    if (!window.confirm(`Delete ${p.key}${p.shared ? ' for everyone in your organization' : ''}?`)) return;
    try {
      await apiJson(`/api/smart-phrases/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      await load();
      reload();
      flash('Phrase deleted');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not delete the phrase');
    }
  }

  const canEdit = (p: CustomPhrase) => p.mine || (p.shared && canManageShared);
  const formKeyError = form && form.key.length > 1 ? smartPhraseKeyError(form.key.trim().toLowerCase()) : null;
  const formBlanks = form ? findUnfilledBlanks(form.text) : 0;

  function renderCustom(list: CustomPhrase[], emptyText: string) {
    if (list.length === 0) {
      return <p className="px-5 py-6 text-sm text-slate-500">{emptyText}</p>;
    }
    return (
      <ul className="divide-y divide-slate-100">
        {list.map((p) => (
          <li key={p.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <KeyBadge value={p.key} />
              <span className="text-sm font-semibold text-slate-900">{p.label}</span>
              {p.category && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {p.category}
                </span>
              )}
              {BUILT_IN_KEYS.has(p.key) && (
                <span className="text-[11px] text-amber-700">Replaces the built-in {p.key}</span>
              )}
              {canEdit(p) && (
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                    aria-label={`Edit ${p.key}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Delete ${p.key}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-2">
              <PhrasePreview text={p.text} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed right-5 top-5 z-50 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      <PageHeader
        title="Smart Phrases"
        description={<>Type the key (for example <KeyBadge value=".mood" />) then Space or Tab in any note field to insert the phrase. Fill every <span className="rounded bg-amber-100 px-1 font-mono text-amber-800">[___]</span> blank before signing.</>}
        actions={<>
          <button
          type="button"
          onClick={() => {
            setFormError(null);
            setForm({ ...EMPTY_FORM });
          }}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus size={15} /> New phrase
        </button>
        </>}
      />

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search keys, labels, or text"
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>

      {form && (
        <form onSubmit={save} className="rounded-xl border border-blue-600/40 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">{form.id ? 'Edit phrase' : 'New phrase'}</h2>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Key</span>
              <input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/\s/g, '') })}
                maxLength={SMART_PHRASE_LIMITS.key}
                placeholder=".my-intro"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
              {formKeyError ? (
                <span className="mt-1 block text-xs text-rose-600">{formKeyError}</span>
              ) : BUILT_IN_KEYS.has(form.key.trim()) ? (
                <span className="mt-1 block text-xs text-amber-700">This key replaces the built-in phrase for you.</span>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Label</span>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                maxLength={SMART_PHRASE_LIMITS.label}
                placeholder="Short description"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Category (optional)
              </span>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                maxLength={SMART_PHRASE_LIMITS.category}
                list="smart-phrase-categories"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
              <datalist id="smart-phrase-categories">
                {SMART_PHRASE_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Phrase text</span>
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              maxLength={SMART_PHRASE_LIMITS.text}
              rows={5}
              placeholder="Use [___] where the clinician must fill in details."
              className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <span className="mt-1 block text-xs text-slate-500">
              {form.text.length}/{SMART_PHRASE_LIMITS.text} characters · {formBlanks} blank{formBlanks === 1 ? '' : 's'}
            </span>
          </label>
          {form.text.trim() && (
            <div className="mt-3 rounded-xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
              <PhrasePreview text={form.text} />
            </div>
          )}
          {!form.id && canManageShared && (
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.shared}
                onChange={(e) => setForm({ ...form, shared: e.target.checked })}
                className="rounded accent-blue-600"
              />
              Share with everyone in my organization
            </label>
          )}
          {formError && <p className="mt-3 text-sm text-rose-600">{formError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={buttonClasses({ variant: 'primary' })}
            >
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create phrase'}
            </button>
          </div>
        </form>
      )}

      {loadError && (
        <Alert tone="danger">
          {loadError}. Built-in phrases still work.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <User size={15} className="text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">My phrases</h2>
            <span className="ml-auto text-xs text-slate-500">{loading ? 'Loading…' : mine.length}</span>
          </header>
          {!loading && renderCustom(mine, q ? 'No matches.' : 'You have not created any phrases yet.')}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Users size={15} className="text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Shared with my organization</h2>
            <span className="ml-auto text-xs text-slate-500">{loading ? 'Loading…' : shared.length}</span>
          </header>
          {!loading &&
            renderCustom(
              shared,
              q
                ? 'No matches.'
                : canManageShared
                  ? 'No shared phrases yet. Tick "Share with everyone" when creating one.'
                  : 'No shared phrases yet. An administrator or practice director can add them.'
            )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <BookOpen size={15} className="text-blue-600" />
          <h2 className="text-sm font-bold text-slate-900">Try it</h2>
        </header>
        <div className="p-5">
          <SmartPhraseTextarea
            value={tryText}
            onChange={setTryText}
            rows={4}
            placeholder="Type a key such as .mood and press Space. Nothing typed here is saved."
            className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Lock size={15} className="text-slate-500" />
          <h2 className="text-sm font-bold text-slate-900">Built-in phrases</h2>
          <span className="text-xs text-slate-500">(read-only; copy one to customize it)</span>
          <span className="ml-auto text-xs text-slate-500">{builtIns.length}</span>
        </header>
        {builtIns.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No matches.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {builtIns.map((p) => (
              <li key={p.key} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyBadge value={p.key} />
                  <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {p.category}
                  </span>
                  {overriddenKeys.has(p.key) && (
                    <span className="text-[11px] text-amber-700">Replaced by a custom phrase</span>
                  )}
                  <button
                    type="button"
                    onClick={() => startFromBuiltIn(p)}
                    className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-600/10"
                  >
                    Copy and edit
                  </button>
                </div>
                <div className="mt-2">
                  <PhrasePreview text={p.text} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
