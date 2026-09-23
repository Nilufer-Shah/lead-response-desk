import type { LeadCard } from "@/domain/read-models";
export type DemoLead = LeadCard;

export const demoLeads: DemoLead[] = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Priya Sharma", phone: "+91 98765 43210", city: "Andheri", ad: "Festive Silk Collection · Video A", campaign: "Festive Silk Collection", owner: "Ashwini", state: "breach", timer: -738, followup: "Call now", stage: "New", attempts: 0, connected: false, quality: "Unrated" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Meera Joshi", phone: "+91 98200 11223", city: "Bandra", ad: "Wedding Edit · Carousel B", campaign: "Wedding Edit", owner: "Ashwini", state: "breach", timer: -222, followup: "Call now", stage: "New", attempts: 0, connected: false, quality: "Unrated" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Nisha Patel", phone: "+971 50 123 4567", city: "Dubai", ad: "International Bridal · Video", campaign: "International Bridal", owner: "Harsh", state: "warn", timer: 66, followup: "Call now", stage: "New", attempts: 0, connected: false, quality: "Unrated" },
  { id: "10000000-0000-4000-8000-000000000004", name: "Kavita Rao", phone: "+91 98920 42020", city: "Powai", ad: "Heritage Weaves · Image C", campaign: "Heritage Weaves", owner: "Rhea", state: "calm", timer: 218, followup: "Call now", stage: "New", attempts: 0, connected: false, quality: "Unrated" },
  { id: "10000000-0000-4000-8000-000000000005", name: "Anjali Desai", phone: "+91 90040 12121", city: "Juhu", ad: "Wedding Edit · Video A", campaign: "Wedding Edit", owner: "Ashwini", state: "calm", timer: 3600, followup: "Follow up 2 of 5 · 2:00 PM", stage: "Contacted", attempts: 1, connected: false, quality: "Unrated" },
  { id: "10000000-0000-4000-8000-000000000006", name: "Sonal Shah", phone: "+91 92222 11112", city: "Santacruz", ad: "Festive Silk Collection · Video A", campaign: "Festive Silk Collection", owner: "Ashwini", state: "calm", timer: 7200, followup: "Visit today · 5:30 PM", stage: "Visit booked", attempts: 3, connected: true, quality: "Good" },
];

export const leadTimeline = [
  { at: "12:05 PM", title: "WhatsApp delivered", detail: "First-touch template · Read at 1:10 PM", tone: "calm" },
  { at: "12:04 PM", title: "Called, no answer", detail: "Disposition logged 38 seconds later", tone: "neutral" },
  { at: "11:52 AM", title: "First-touch SLA breached", detail: "Manager notified after 15 business minutes", tone: "breach" },
  { at: "11:37 AM", title: "Assigned to Ashwini", detail: "Round robin · Santacruz roster", tone: "neutral" },
  { at: "11:37 AM", title: "Lead received", detail: "Festive Silk Collection · Video A", tone: "neutral" },
];

export const qualityRows = [
  { name: "Ritika B.", flag: "Spam", attempts: "2 calls", days: "1 day", whatsapp: "None", note: "No response", status: "Gate failed" },
  { name: "Pooja A.", flag: "Unreachable", attempts: "4 attempts", days: "3 days", whatsapp: "Delivered", note: "Called across three days", status: "Ready for review" },
  { name: "Shreya M.", flag: "Budget mismatch", attempts: "3 attempts", days: "2 days", whatsapp: "Read", note: "Looking below ₹5,000", status: "Ready for review" },
  { name: "Devika K.", flag: "Wrong person", attempts: "1 call", days: "1 day", whatsapp: "None", note: "Number belongs to Rohan", status: "Gate failed" },
];
