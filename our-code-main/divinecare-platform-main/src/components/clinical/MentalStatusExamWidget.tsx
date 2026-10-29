'use client';

import { useState } from 'react';

export type MseValue = {
  appearance: string[];
  behavior: string[];
  eyeContact: string;
  speechRate: string;
  speechVolume: string;
  mood: string;
  moodDescription: string;
  affect: string[];
  thoughtProcess: string[];
  thoughtContent: string[];
  perceptions: string[];
  perceptionDetails: string;
  cognition: string;
  insight: string;
  judgment: string;
  additionalNotes: string;
};

export const DEFAULT_MSE_VALUE: MseValue = {
  appearance: ['Neat/Clean'],
  behavior: ['Cooperative'],
  eyeContact: 'Good',
  speechRate: 'Normal',
  speechVolume: 'Normal',
  mood: 'Euthymic',
  moodDescription: '',
  affect: ['Full Range'],
  thoughtProcess: ['Goal-Directed'],
  thoughtContent: ['No Delusions/Paranoia'],
  perceptions: ['No Hallucinations'],
  perceptionDetails: '',
  cognition: 'Alert & Oriented x4',
  insight: 'Good',
  judgment: 'Good',
  additionalNotes: '',
};

type Props = {
  value: MseValue;
  onChange: (value: MseValue) => void;
  disabled?: boolean;
};

export function MentalStatusExamWidget({ value = DEFAULT_MSE_VALUE, onChange, disabled = false }: Props) {
  const toggleArrayItem = (key: keyof MseValue, item: string) => {
    if (disabled) return;
    const current = (value[key] as string[]) || [];
    const updated = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item];
    onChange({ ...value, [key]: updated });
  };

  const setSingleItem = (key: keyof MseValue, val: string) => {
    if (disabled) return;
    onChange({ ...value, [key]: val });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <h3 className="text-base font-bold text-gray-900">Mental Status Examination (MSE)</h3>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
          Structured Clinical Examination
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Appearance */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Appearance</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {['Neat/Clean', 'Disheveled', 'Unkempt', 'Appropriate Dress', 'Inappropriate Dress', 'Younger Than Age', 'Older Than Age'].map((item) => {
              const active = (value.appearance || []).includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArrayItem('appearance', item)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* Behavior */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Behavior & Motor</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {['Cooperative', 'Agitated', 'Restless', 'Guarded', 'Calm', 'Hyperactive', 'Psychomotor Retardation', 'Tics/Tremors'].map((item) => {
              const active = (value.behavior || []).includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArrayItem('behavior', item)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* Eye Contact */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Eye Contact</label>
          <select
            value={value.eyeContact || 'Good'}
            onChange={(e) => setSingleItem('eyeContact', e.target.value)}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
          >
            {['Good', 'Intermittent', 'Avoidant', 'Staring', 'Poor'].map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Speech Rate & Volume */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Speech Rate & Volume</label>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <select
              value={value.speechRate || 'Normal'}
              onChange={(e) => setSingleItem('speechRate', e.target.value)}
              disabled={disabled}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
            >
              {['Normal Rate', 'Rapid', 'Pressured', 'Slow', 'Hesitant'].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <select
              value={value.speechVolume || 'Normal'}
              onChange={(e) => setSingleItem('speechVolume', e.target.value)}
              disabled={disabled}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
            >
              {['Normal Volume', 'Loud', 'Soft/Whispered', 'Monotone'].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Mood & Affect */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Mood</label>
          <select
            value={value.mood || 'Euthymic'}
            onChange={(e) => setSingleItem('mood', e.target.value)}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
          >
            {['Euthymic', 'Depressed', 'Anxious', 'Irritable', 'Elevated/Euphoric', 'Labile', 'Anhedonic'].map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Patient's own words describing mood..."
            value={value.moodDescription || ''}
            onChange={(e) => setSingleItem('moodDescription', e.target.value)}
            disabled={disabled}
            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-indigo-400"
          />
        </div>

        {/* Affect */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Affect</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {['Full Range', 'Blunted', 'Flat', 'Constricted', 'Incongruent', 'Labile', 'Tearful'].map((item) => {
              const active = (value.affect || []).includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArrayItem('affect', item)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thought Process */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Thought Process</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {['Goal-Directed', 'Logical/Coherent', 'Circumstantial', 'Tangential', 'Flight of Ideas', 'Loose Associations', 'Perseverative'].map((item) => {
              const active = (value.thoughtProcess || []).includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArrayItem('thoughtProcess', item)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thought Content */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Thought Content</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {['No Delusions/Paranoia', 'Suicidal Ideation', 'Homicidal Ideation', 'Paranoid Delusions', 'Grandiosities', 'Obsessions/Preoccupations', 'Phobias'].map((item) => {
              const active = (value.thoughtContent || []).includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArrayItem('thoughtContent', item)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? item.includes('Ideation') ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {/* Insight & Judgment */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Insight & Judgment</label>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <div>
              <span className="text-[11px] text-gray-500">Insight</span>
              <select
                value={value.insight || 'Good'}
                onChange={(e) => setSingleItem('insight', e.target.value)}
                disabled={disabled}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
              >
                {['Good', 'Fair', 'Impaired/Poor', 'Absent'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-[11px] text-gray-500">Judgment</span>
              <select
                value={value.judgment || 'Good'}
                onChange={(e) => setSingleItem('judgment', e.target.value)}
                disabled={disabled}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
              >
                {['Good', 'Fair', 'Impaired/Poor', 'Impaired in Crisis'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Cognition */}
        <div>
          <label className="block text-xs font-semibold text-gray-700">Cognition & Sensorium</label>
          <select
            value={value.cognition || 'Alert & Oriented x4'}
            onChange={(e) => setSingleItem('cognition', e.target.value)}
            disabled={disabled}
            className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
          >
            {['Alert & Oriented x4', 'Oriented x3 (Disoriented to Time)', 'Concentration Impaired', 'Memory Impaired', 'Confused/Delirious'].map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700">Additional MSE Notes</label>
        <textarea
          rows={2}
          value={value.additionalNotes || ''}
          onChange={(e) => setSingleItem('additionalNotes', e.target.value)}
          disabled={disabled}
          placeholder="Additional MSE clinical observations..."
          className="mt-1.5 w-full rounded-xl border border-gray-200 p-3 text-xs outline-none focus:border-indigo-400"
        />
      </div>
    </div>
  );
}
