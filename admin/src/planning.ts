/** Booking planning contracts shared by the private UI and its server. */
export type PartyBand = { id: string; label: string; min: number; max: number; deposit: number | null }
export type BookingSettings = {
  partyBands: PartyBand[]; planningFee: number | null; checkoutMinutes: number | null;
  postageAllowance: number | null; kitchenRequirements: string; travelMiles: number; maxGuests: number;
  interviewScheduling: 'undecided' | 'self_schedule' | 'sergio_arranges';
  interviewSlots: { id: string; at: string }[]; policyVersion: number;
  ceilingIncludes: string; laterCancellationPolicy: string; tableCancellationPolicy: string;
}
export const defaultBookingSettings = (): BookingSettings => ({
  partyBands: [
    { id: 'small', label: '1–6 guests', min: 1, max: 6, deposit: null },
    { id: 'medium', label: '7–12 guests', min: 7, max: 12, deposit: null },
    { id: 'large', label: '13–24 guests', min: 13, max: 24, deposit: null },
  ], planningFee: null, checkoutMinutes: null, postageAllowance: null, kitchenRequirements: '',
  travelMiles: 75, maxGuests: 24, interviewScheduling: 'undecided', interviewSlots: [], policyVersion: 1,
  ceilingIncludes: '', laterCancellationPolicy: '', tableCancellationPolicy: '',
})
export type HostPlanningBrief = {
  dateMode: 'exact' | 'flexible' | 'undecided'; dateFrom: string | null; dateTo: string | null;
  partyBandId: string; partyBandLabel: string; headcount: number | null; kitchen: string;
  budgetMode: 'range' | 'guidance'; budgetMin: number | null; budgetMax: number | null;
  budgetUnit: 'total' | 'per_person'; foodIdeas: string; allergies: string; physicalInvitations: boolean;
}
export type InterviewTopic = {
  id: string; label: string; supplied: string; status: 'unknown' | 'tentative' | 'agreed';
  answer: string; notes: string; updatedAt: string | null; updatedBy: string;
}
export type PlanningEvent = { id: string; at: string; actor: string; description: string }
export type BookingPlanning = {
  original: HostPlanningBrief; topics: InterviewTopic[]; followUp: string;
  spendingCeiling: number | null; agreed: { date: string | null; time: string | null; guests: number | null };
  interview: { status: 'unscheduled' | 'scheduled' | 'invitation_sent' | 'completed'; scheduledAt: string | null; meetUrl: string; sentAt: string | null; sentReference: string; completedAt: string | null };
  deposit: { amount: number | null; status: 'unpaid' | 'paid' | 'refund_pending' | 'refunded'; paid: number; policyVersion: number; planningFeeMaximum: number | null };
  dateReserved: boolean;
  menu: { text: string; price: number | null; status: 'draft' | 'finalized'; finalizedAt: string | null };
  eventInvitation: { url: string; physical: boolean; postage: number | null; sentAt: string | null; sentReference: string };
  cancellation: { requestedAt: string | null; feeEligible: boolean; retainedFee: number | null; refundAmount: number | null; refundStatus: 'none' | 'pending' | 'completed' | 'review'; reason: string };
  events: PlanningEvent[];
}
export const topicLabels: Record<string, string> = { date: 'Date and time', party: 'Party size', location: 'Location', kitchen: 'Kitchen', budget: 'Spending range', menu: 'Menu direction', dietary: 'Dietary needs and allergies' }
export function missingTopics(plan?: BookingPlanning): InterviewTopic[] { return plan?.topics.filter(topic => topic.status !== 'agreed') ?? [] }
export function paymentConfigurationIssues(settings: BookingSettings): string[] {
  const issues: string[] = []
  if (!settings.partyBands.length || settings.partyBands.some(band => band.deposit === null || band.deposit <= 0)) issues.push('Set each party-band deposit.')
  if (settings.planningFee === null) issues.push('Set the disclosed planning fee.')
  if (settings.checkoutMinutes === null) issues.push('Set the checkout hold duration.')
  if (!settings.kitchenRequirements.trim()) issues.push('Confirm the kitchen requirements.')
  if (!settings.ceilingIncludes.trim()) issues.push('Define what the spending ceiling includes.')
  if (!settings.laterCancellationPolicy.trim()) issues.push('Set the later event cancellation policy.')
  if (!settings.tableCancellationPolicy.trim()) issues.push('Set the paid Table guest cancellation policy.')
  return issues
}
