'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  X,
  Send,
  Sparkles,
  ShieldAlert,
  PhoneCall,
  Heart,
  Activity,
  CheckCircle2,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface AriaMessage {
  id: string;
  sender: 'user' | 'aria';
  text: string;
  timestamp: string;
  exercise?: {
    title: string;
    steps: string[];
  };
  crisis?: boolean;
}

export function AriaChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [crisisAlert, setCrisisAlert] = useState(false);
  const [messages, setMessages] = useState<AriaMessage[]>([
    {
      id: 'welcome',
      sender: 'aria',
      text: 'Hello, I’m Aria — your trauma-informed wellness companion powered by AWS Bedrock. How are you feeling today?',
      timestamp: 'Just now',
      exercise: {
        title: 'Quick 4-7-8 Centering',
        steps: [
          'Inhale gently through nose for 4s',
          'Hold breath calmly for 7s',
          'Exhale slowly through mouth for 8s',
        ],
      },
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const sendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim();
    if (!textToSend || loading) return;

    const userMsg: AriaMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/agents/aria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: textToSend }),
      });

      const data = await res.json();
      if (data.success && data.reply) {
        if (data.crisisDetected) {
          setCrisisAlert(true);
        }

        const ariaMsg: AriaMessage = {
          id: `aria-${Date.now()}`,
          sender: 'aria',
          text: data.reply.encouragement || data.reply.summary,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          exercise: data.reply.suggested_exercise,
          crisis: data.crisisDetected,
        };

        setMessages((prev) => [...prev, ariaMsg]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: 'aria',
            text: data.error || 'I am currently unable to connect. If you need help, please call 988.',
            timestamp: 'Now',
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'aria',
          text: 'Connection error. If you need immediate support, the 988 Suicide & Crisis Lifeline is available 24/7.',
          timestamp: 'Now',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating launcher button */}
      <div className="fixed bottom-6 right-6 z-40 print:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2.5 rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xl shadow-indigo-500/25 transition-all hover:scale-105 hover:shadow-indigo-500/40 active:scale-95"
          aria-label="Open Aria Companion"
        >
          <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
            <Bot className="h-4 w-4 text-white" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-indigo-600" />
          </div>
          <span className="hidden sm:inline">Aria Copilot</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-white">
            Bedrock
          </span>
        </button>
      </div>

      {/* Slide-over drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-sm transition-opacity">
          <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
            <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
              {/* Header */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-900 via-slate-900 to-purple-950 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 ring-1 ring-white/20">
                      <Bot className="h-5 w-5 text-indigo-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-white">Aria Wellness Companion</h2>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                          Live Bedrock
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Claude 3 Haiku · Trauma-informed AI
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close Aria chat"
                    className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                {crisisAlert && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                    <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-white">988 Lifeline Escalation Active</p>
                      <p className="text-[11px] text-red-200/90">
                        Free, confidential support is available 24/7.
                      </p>
                      <a
                        href="tel:988"
                        className="mt-1.5 inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700"
                      >
                        <PhoneCall className="h-3 w-3" /> Call or Text 988
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-sm ${
                        m.sender === 'user'
                          ? 'bg-brand-600 text-white rounded-tr-none'
                          : m.crisis
                          ? 'bg-red-50 text-red-900 border border-red-200 rounded-tl-none'
                          : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                      }`}
                    >
                      <p>{m.text}</p>

                      {m.exercise && (
                        <div className="mt-2.5 rounded-xl border border-indigo-100 bg-indigo-50/70 p-2.5 text-indigo-950">
                          <p className="font-bold text-[11px] text-indigo-900 flex items-center gap-1 mb-1">
                            <Sparkles className="h-3 w-3 text-indigo-600" />
                            {m.exercise.title}
                          </p>
                          <ul className="space-y-1">
                            {m.exercise.steps.map((step, idx) => (
                              <li key={idx} className="text-[11px] text-indigo-900/90 flex gap-1.5">
                                <span className="font-semibold text-indigo-600">{idx + 1}.</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <span className="mt-1 text-[11px] text-slate-500 px-1">{m.timestamp}</span>
                  </div>
                ))}

                {loading && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 w-fit">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                    <span>Aria is thinking with Claude 3 Haiku…</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Prompt Chips */}
              <div className="border-t border-slate-200/80 bg-white p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Quick Prompts
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'I am feeling anxious',
                    'Guide me through breathing',
                    'Need a 5-minute grounding exercise',
                    'How do I handle racing thoughts?',
                  ].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => sendMessage(chip)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input bar */}
              <div className="border-t border-slate-200 bg-white p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    aria-label="Message Aria"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Message Aria…"
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    aria-label="Send message"
                    className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-40 transition"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                  </button>
                </form>
                <p className="mt-2 text-center text-[11px] text-slate-500">
                  Processed via AWS Bedrock under HIPAA BAA. PHI is never stored or trained on.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
