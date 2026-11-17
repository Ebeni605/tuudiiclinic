import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Prescription = Database["public"]["Tables"]["prescriptions"]["Row"];
export const MEDICINE_FIELDS = ["drug_name", "brand_name", "strength", "dosage_form", "dose", "route", "frequency", "duration", "quantity", "instructions", "other_information"] as const;
export type Medicine = Record<(typeof MEDICINE_FIELDS)[number], string>;
export const emptyMedicine = (): Medicine => Object.fromEntries(MEDICINE_FIELDS.map(k => [k, ""])) as Medicine;
export function canEditPrescription(userId: string | undefined, clinician: boolean, r: Pick<Prescription, "clinician_id" | "status">) {
  return clinician && userId === r.clinician_id && r.status === "draft";
}
export function canPrintPrescription(r: Pick<Prescription, "status">) {
  return r.status === "finalized" || r.status === "printed";
}
export function authorizationProblems(items: Medicine[], diagnosis: string, qualification: string | null, registration: string | null) {
  const problems: string[] = [];
  if (!diagnosis) problems.push("Select an encounter diagnosis.");
  if (!qualification?.trim() || !registration?.trim()) problems.push("Administrator must confirm prescriber qualification and professional registration.");
  if (!items.length || items.length > 50) problems.push("Enter between 1 and 50 medicines.");
  items.forEach((m, i) => {
    const missing = (["drug_name", "dose", "route", "frequency", "duration", "quantity"] as const).filter(k => !m[k].trim());
    if (missing.length) problems.push(`Medicine ${i + 1}: complete ${missing.map(k => k.replaceAll("_", " ")).join(", ")}.`);
  });
  return problems;
}
export const prescriptionHistoryQuery = (patientId: string) => queryOptions({
  queryKey: ["prescriptions", patientId], queryFn: async () => {
    const { data, error } = await supabase.from("prescriptions").select("*, prescription_items(*)").eq("patient_id", patientId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
export const prescriptionQuery = (id: string) => queryOptions({
  queryKey: ["prescription", id], queryFn: async () => {
    const { data, error } = await supabase.from("prescriptions").select("*, prescription_items(*), prescription_events(*)").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
});