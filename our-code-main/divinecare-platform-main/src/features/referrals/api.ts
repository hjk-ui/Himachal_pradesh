import { apiJson } from '@/lib/api-client';

export type ReferralDirection = 'incoming' | 'outgoing';
export type ReferralStatus = 'pending' | 'accepted' | 'converted' | 'declined';

export type CommunityReferral = {
  id: string;
  direction: ReferralDirection;
  patientName: string;
  sourceType: string;
  sourceName: string;
  referralDate: string;
  status: ReferralStatus;
  convertedAt: string | null;
  notes: string;
  daysSinceReferral: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateReferralInput = {
  direction: ReferralDirection;
  patientName: string;
  sourceType: string;
  sourceName?: string | null;
  referralDate: string;
  notes?: string | null;
};

export async function fetchReferrals() {
  return apiJson<{ success: true; referrals: CommunityReferral[] }>('/api/referrals');
}

export async function createReferral(input: CreateReferralInput) {
  const data = await apiJson<{ success: true; referral: CommunityReferral }>('/api/referrals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.referral;
}

export async function updateReferral(
  id: string,
  input: { status?: ReferralStatus; notes?: string | null }
) {
  const data = await apiJson<{ success: true; referral: CommunityReferral }>(
    `/api/referrals/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
  return data.referral;
}
