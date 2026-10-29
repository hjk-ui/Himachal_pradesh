'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export type UserRole =
  | 'practice_director'  // Marcus Johnson — Executive leadership
  | 'psychiatrist'       // Dr. James Park — MD, clinical director
  | 'physician'          // MD/DO (primary care / family medicine) — medical dept only
  | 'np'                 // PMHNP — psychiatric NP, behavioral health + medication mgmt
  | 'medical_np'         // FNP/AGNP — family/adult NP, medical dept only
  | 'medical_assistant'  // CMA — medical dept: rooming, vitals, intake prep, visit support
  | 'crisis_responder'   // Mobile crisis team — triage, dispatch response, on-scene documentation
  | 'therapist'          // Dr. Sarah Smith — LCSW, adult & adolescent
  | 'prp_specialist'     // PRP Counselor — PRP program, rehabilitation notes
  | 'case_manager'       // Care coordination — no prescribing, limited EHR
  | 'peer_support'       // Peer support specialist — non-clinical, community
  | 'office_manager'     // Kevin Davis — Operations, intake, billing
  | 'billing_specialist' // Sandra Lee — Claims, billing, revenue cycle
  | 'hr_manager'         // HR Manager — credentialing, onboarding, compliance
  | 'client';            // Client / Patient — portal & mobile view

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  title?: string;
  credentials?: string;
  npi?: string;
  dea?: string;
}

export interface RoleConfig {
  label: string;
  color: string;
  bg: string;
  icon: string;
  group: 'clinical' | 'administrative' | 'client';
  description: string;
}

export const ROLE_CONFIG: Record<UserRole, RoleConfig> = {
  practice_director: {
    label: 'Practice Director',
    color: '#5C2D91', bg: '#F3EEFF', icon: '🏢',
    group: 'administrative',
    description: 'Full access — all clinical, EHR, business, and admin functions',
  },
  psychiatrist: {
    label: 'Psychiatrist',
    color: '#1565C0', bg: '#E3F2FD', icon: '🧑‍⚕️',
    group: 'clinical',
    description: 'Clinical, EHR, e-prescribing (Schedule I–V), psych evaluations',
  },
  physician: {
    label: 'Physician',
    color: '#0D47A1', bg: '#E8EAF6', icon: '🩺',
    group: 'clinical',
    description: 'MD/DO primary care / family medicine — medical dept only, prescribing, ordering',
  },
  medical_np: {
    label: 'Medical NP',
    color: '#1565C0', bg: '#E3F2FD', icon: '💊',
    group: 'clinical',
    description: 'FNP/AGNP — family or adult-gerontology NP, medical dept only, limited prescribing',
  },
  np: {
    label: 'Nurse Practitioner',
    color: '#1976D2', bg: '#E8F4FD', icon: '💊',
    group: 'clinical',
    description: 'Clinical, EHR, limited prescribing, psychiatric assessments',
  },
  medical_assistant: {
    label: 'Medical Assistant',
    color: '#00838F', bg: '#E0F7FA', icon: '🩹',
    group: 'clinical',
    description: 'Medical dept — patient rooming, vitals, intake prep, visit & lab support',
  },
  crisis_responder: {
    label: 'Crisis Responder',
    color: '#C62828', bg: '#FFEBEE', icon: '🚨',
    group: 'clinical',
    description: 'Mobile crisis team — triage, dispatch response, on-scene documentation, follow-ups',
  },
  therapist: {
    label: 'Therapist',
    color: '#00897B', bg: '#E0F2F1', icon: '🩺',
    group: 'clinical',
    description: 'Clinical, EHR notes, treatment plans, outcome measures',
  },
  prp_specialist: {
    label: 'PRP Specialist',
    color: '#00695C', bg: '#E0F2EF', icon: '🧩',
    group: 'clinical',
    description: 'PRP program management, rehabilitation notes, community',
  },
  case_manager: {
    label: 'Case Manager',
    color: '#E65100', bg: '#FFF3E0', icon: '🤝',
    group: 'clinical',
    description: 'Care coordination, client communication, community resources',
  },
  peer_support: {
    label: 'Peer Support',
    color: '#E8673A', bg: '#FFF0EB', icon: '💛',
    group: 'clinical',
    description: 'Peer support groups, community outreach, lived-experience model',
  },
  office_manager: {
    label: 'Office Manager',
    color: '#37474F', bg: '#ECEFF1', icon: '📋',
    group: 'administrative',
    description: 'Scheduling, client intake, eligibility, billing oversight',
  },
  billing_specialist: {
    label: 'Billing Specialist',
    color: '#F57F17', bg: '#FFFDE7', icon: '💳',
    group: 'administrative',
    description: 'Claims, CPT codes, insurance, ERA/EOB, eligibility',
  },
  hr_manager: {
    label: 'HR Manager',
    color: '#880E4F', bg: '#FCE4EC', icon: '👔',
    group: 'administrative',
    description: 'Staff management, credentialing, hiring, training & CEUs',
  },
  client: {
    label: 'Client',
    color: '#E8673A', bg: '#FFF0EB', icon: '🌸',
    group: 'client',
    description: 'Mobile app — wellness tools, check-ins, messages, Aria AI',
  },
};

// ─── Demo Personas ────────────────────────────────────────────────────────────
export const DEMO_USERS: Record<UserRole, AuthUser> = {
  practice_director: {
    uid: 'demo-director',
    email: 'mjohnson@divinecounseling.com',
    displayName: 'Marcus Johnson',
    role: 'practice_director',
    title: 'Practice Director',
  },
  psychiatrist: {
    uid: 'demo-psychiatrist',
    email: 'dr.park@divinecounseling.com',
    displayName: 'Dr. James Park',
    role: 'psychiatrist',
    title: 'Psychiatrist',
    credentials: 'MD, Board Certified',
  },
  physician: {
    uid: 'demo-physician',
    email: 'dr.okafor@divinecounseling.com',
    displayName: 'Dr. Emeka Okafor',
    role: 'physician',
    title: 'Physician',
    credentials: 'MD, FAAFP',
  },
  medical_np: {
    uid: 'demo-medical-np',
    email: 'j.walsh@divinecounseling.com',
    displayName: 'Jennifer Walsh',
    role: 'medical_np',
    title: 'Nurse Practitioner (Medical)',
    credentials: 'FNP-C',
  },
  np: {
    uid: 'demo-np',
    email: 'm.rivera@divinecounseling.com',
    displayName: 'Maria Rivera',
    role: 'np',
    title: 'Nurse Practitioner',
    credentials: 'CRNP, PMHNP-BC',
  },
  medical_assistant: {
    uid: 'demo-ma',
    email: 'a.brooks@divinecounseling.com',
    displayName: 'Alicia Brooks',
    role: 'medical_assistant',
    title: 'Medical Assistant',
    credentials: 'CMA (AAMA)',
  },
  crisis_responder: {
    uid: 'demo-crisis',
    email: 'k.osei@divinecounseling.com',
    displayName: 'Kofi Osei',
    role: 'crisis_responder',
    title: 'Crisis Responder',
    credentials: 'LCSW-C',
  },
  therapist: {
    uid: 'demo-therapist',
    email: 'dr.smith@divinecounseling.com',
    displayName: 'Dr. Sarah Smith',
    role: 'therapist',
    title: 'Therapist',
    credentials: 'LCSW',
  },
  prp_specialist: {
    uid: 'demo-prp',
    email: 't.williams@divinecounseling.com',
    displayName: 'Tony Williams',
    role: 'prp_specialist',
    title: 'PRP Specialist',
    credentials: 'CPRS',
  },
  case_manager: {
    uid: 'demo-cm',
    email: 'l.chen@divinecounseling.com',
    displayName: 'Lisa Chen',
    role: 'case_manager',
    title: 'Case Manager',
    credentials: 'CCM',
  },
  peer_support: {
    uid: 'demo-peer',
    email: 'd.roberts@divinecounseling.com',
    displayName: 'Darius Roberts',
    role: 'peer_support',
    title: 'Peer Support Specialist',
    credentials: 'CPSS',
  },
  office_manager: {
    uid: 'demo-om',
    email: 'k.davis@divinecounseling.com',
    displayName: 'Kevin Davis',
    role: 'office_manager',
    title: 'Office Manager',
  },
  billing_specialist: {
    uid: 'demo-billing',
    email: 's.lee@divinecounseling.com',
    displayName: 'Sandra Lee',
    role: 'billing_specialist',
    title: 'Billing Specialist',
    credentials: 'CPC',
  },
  hr_manager: {
    uid: 'demo-hr',
    email: 'r.thomas@divinecounseling.com',
    displayName: 'Rachel Thomas',
    role: 'hr_manager',
    title: 'HR Manager',
    credentials: 'PHR',
  },
  client: {
    uid: 'demo-client',
    email: 'jordan.m@email.com',
    displayName: 'Jordan Mitchell',
    role: 'client',
    title: 'Client',
  },
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('dc_demo_mode') === 'true') {
      const roleKey = (localStorage.getItem('dc_demo_role') as UserRole) || 'therapist';
      setUser(DEMO_USERS[roleKey] ?? DEMO_USERS.therapist);
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          role: 'therapist',
          title: 'Staff',
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dc_demo_mode');
      localStorage.removeItem('dc_demo_role');
    }
    setUser(null);
    return signOut(auth).catch(() => {});
  };

  const switchDemoRole = (role: UserRole) => {
    localStorage.setItem('dc_demo_role', role);
    setUser(DEMO_USERS[role]);
  };

  return { user, loading, logout, switchDemoRole };
}
