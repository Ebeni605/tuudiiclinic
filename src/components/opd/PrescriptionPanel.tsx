import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Plus, Printer, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError, PageLoading } from "@/components/AppShell";
import { useStaff } from "@/lib/auth";
import { dxQuery, fmtDateTime } from "@/lib/opd-queries";
import { authorizationProblems, canEditPrescription, emptyMedicine, MEDICINE_FIELDS, prescriptionHistoryQuery, type Medicine, type Prescription } from "@/lib/prescriptions";
import { supabase } from "@/integrations/supabase/client";
import { F } from "./Field";

const LABELS: Record<keyof Medicine, string> = { drug_name: "Generic drug name", brand_name: "Brand name", strength: "Strength", dosage_form: "Dosage form", dose: "Dose", route: "Route", frequency: "Frequency", duration: "Duration", quantity: "Quantity", instructions: "How to use", other_information: "Other information" };

export function PrescriptionPanel({ visitId, patientId, clinicianId, validEncounter }: { visitId: string; patientId: string; clinicianId: string | null; validEncounter: boolean }) {
  const { data: me } = useStaff();
  const qc = useQueryClient();
  const history = useQuery(prescriptionHistoryQuery(patientId));
  const { data: diagnoses } = useQuery(dxQuery(visitId));
  const credentialQuery = useQuery({ queryKey: ["prescriber", clinicianId], enabled: !!clinicianId, queryFn: async () => {
    const { data, error } = await supabase.from("profiles").select("qualification, professional_registration").eq("id", clinicianId ?? "").maybeSingle();
    if (error) throw error;
    return data;
  } });
  const credentials = credentialQuery.data;
  const [editor, setEditor] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [replaces, setReplaces] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [items, setItems] = useState<Medicine[]>([emptyMedicine()]);
  const [busy, setBusy] = useState(false);
  const [authorize, setAuthorize] = useState(false);
  const [cancelling, setCancelling] = useState<Prescription | null>(null);
  const [reason, setReason] = useState("");
  const owner = !!me?.roles.includes("clinician") && me.id === clinicianId;
  const problems = authorizationProblems(items, diagnosis, credentials?.qualification ?? null, credentials?.professional_registration ?? null);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["prescriptions", patientId] }); await qc.invalidateQueries({ queryKey: ["prescription"] }); };

  function open(row?: NonNullable<typeof history.data>[number], reissue = false) {
    setId(row && !reissue ? row.id : null); setReplaces(reissue && row ? row.id : null);
    setDiagnosis(row?.diagnosis_id ?? "");
    setItems(row ? [...row.prescription_items].sort((a, b) => a.position - b.position).map(m => Object.fromEntries(MEDICINE_FIELDS.map(k => [k, m[k]])) as Medicine) : [emptyMedicine()]);
    setEditor(true);
  }
  async function save(finalize = false) {
    if (finalize && problems.length) return;
    if (items.some(m => !m.drug_name.trim())) { toast.error("Enter a generic drug name for every medicine."); return; }
    setBusy(true);
    try {
      const { data: saved, error } = await supabase.rpc("save_prescription", {
        _visit_id: visitId,
        ...(diagnosis ? { _diagnosis_id: diagnosis } : {}),
        _items: items,
        ...(id ? { _prescription_id: id } : {}),
        ...(replaces ? { _replaces_id: replaces } : {}),
      });
      if (error) throw error;
      if (!saved) throw new Error("The prescription was not saved. Please try again.");
      setId(saved);
      if (finalize) {
        const { error: actionError } = await supabase.rpc("prescription_action", { _id: saved, _action: "finalized" });
        if (actionError) throw actionError;
        setEditor(false); setAuthorize(false);
      }
      toast.success(finalize ? "Prescription authorized" : "Prescription draft saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : (e as { message: string }).message); }
    finally { setBusy(false); await refresh(); }
  }
  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("prescription_action", { _id: cancelling.id, _action: "cancelled", _reason: reason.trim() });
      if (error) throw error;
      setCancelling(null); setReason(""); toast.success("Prescription cancelled; history retained"); await refresh();
    } catch (e) { toast.error((e as { message: string }).message); }
    finally { setBusy(false); }
  }
  if (history.isLoading) return <PageLoading label="Loading prescriptions…" />;
  if (history.error) return <LoadError onRetry={() => history.refetch()} />;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Prescriptions</h2>{owner && validEncounter && !editor && <Button onClick={() => open()}><Plus className="mr-2 h-4 w-4" />New prescription</Button>}</div>
    {owner && credentialQuery.error && <LoadError message="Could not check prescriber credentials." onRetry={() => credentialQuery.refetch()} />}
    {owner && !credentialQuery.isPending && !credentialQuery.error && (!credentials?.qualification || !credentials.professional_registration) && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Prescriber credentials awaiting administrator confirmation. Drafts can be saved; authorization is unavailable.</p>}
    {editor && owner && validEncounter && <div className="space-y-4 border-y py-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{replaces ? "Replacement prescription" : id ? "Edit prescription draft" : "New prescription draft"}</h3><Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Close the editor? Unsaved changes will be lost.")) setEditor(false); }}>Close editor</Button></div>
      <F label="Encounter diagnosis" required><Select value={diagnosis || "none"} onValueChange={v => setDiagnosis(v === "none" ? "" : v)}><SelectTrigger aria-label="Encounter diagnosis"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select diagnosis</SelectItem>{diagnoses?.map(d => <SelectItem key={d.id} value={d.id}>{d.description}{d.icd10_code ? ` (${d.icd10_code})` : ""}</SelectItem>)}</SelectContent></Select></F>
      {items.map((m, i) => <fieldset key={i} disabled={busy} className="border-b pb-4"><legend className="mb-3 flex w-full items-center justify-between font-semibold">Medicine {i + 1}<Button title="Remove medicine" aria-label={`Remove medicine ${i + 1}`} size="icon" variant="ghost" disabled={items.length === 1 || busy} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{MEDICINE_FIELDS.map(k => <F key={k} label={LABELS[k]} required={["drug_name", "dose", "route", "frequency", "duration", "quantity"].includes(k)} className={k === "instructions" || k === "other_information" ? "sm:col-span-2" : ""}>{k === "instructions" || k === "other_information" ? <Textarea maxLength={2000} value={m[k]} onChange={e => setItems(items.map((x,j) => j === i ? { ...x, [k]: e.target.value } : x))} /> : <Input maxLength={k === "drug_name" || k === "brand_name" ? 200 : 100} value={m[k]} onChange={e => setItems(items.map((x,j) => j === i ? { ...x, [k]: e.target.value } : x))} />}</F>)}</div></fieldset>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || items.length >= 50} onClick={() => setItems([...items, emptyMedicine()])}><Plus className="mr-2 h-4 w-4" />Add medicine</Button><Button variant="outline" disabled={busy} onClick={() => save()}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button disabled={busy || problems.length > 0} onClick={() => setAuthorize(true)}><FileSignature className="mr-2 h-4 w-4" />Save prescription</Button>{id ? <Button asChild variant="outline"><Link to="/opd/prescription/$prescriptionId" params={{ prescriptionId: id }}><Printer className="mr-2 h-4 w-4" />Preview / print</Link></Button> : <Button variant="outline" disabled title="Save a draft first to preview"><Printer className="mr-2 h-4 w-4" />Preview / print</Button>}<Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Cancel editing? Unsaved changes will be lost.")) setEditor(false); }}>Cancel</Button></div>
      {problems.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    </div>}
    <h3 className="text-sm font-semibold">Patient prescription history</h3>
    {!history.data?.length && <p className="text-sm text-muted-foreground">No prescriptions recorded.</p>}
    <div className="space-y-3">{history.data?.map(r => <article key={r.id} className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-mono text-xs">{r.prescription_number}</p><p className="mt-1 text-sm capitalize">{r.status === "finalized" ? "Authorized" : r.status} · {fmtDateTime(r.created_at)}{r.visit_id !== visitId && " · Previous visit"}</p></div><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/opd/prescription/$prescriptionId" params={{ prescriptionId: r.id }}><Printer className="mr-1 h-4 w-4" />View / print</Link></Button>{validEncounter && r.visit_id === visitId && canEditPrescription(me?.id, owner, r) && <Button size="sm" variant="outline" disabled={busy} onClick={() => open(r)}>Edit draft</Button>}{owner && r.clinician_id === me?.id && r.status !== "cancelled" && <Button size="sm" variant="outline" onClick={() => { setCancelling(r); setReason(""); }}>Cancel prescription</Button>}{owner && validEncounter && r.visit_id === visitId && r.status === "cancelled" && r.clinician_id === me?.id && <Button size="sm" variant="outline" onClick={() => open(r, true)}>Reissue</Button>}</div></div>
      <p className="mt-2 text-sm">{[...r.prescription_items].sort((a,b) => a.position-b.position).map(m => m.drug_name).join(" · ")}</p>{r.cancel_reason && <p className="mt-2 text-sm text-destructive">Cancellation: {r.cancel_reason}</p>}{r.replaces_id && <p className="mt-1 text-xs text-muted-foreground">Replacement for a cancelled prescription</p>}
    </article>)}</div>
    <Dialog open={authorize} onOpenChange={o => !busy && setAuthorize(o)}><DialogContent><DialogHeader><DialogTitle>Authorize this prescription?</DialogTitle><DialogDescription>Your identity and authorization time will be recorded. Medicines and patient details will be locked; corrections require cancellation and reissue.</DialogDescription></DialogHeader><Button disabled={busy || problems.length > 0} onClick={() => save(true)}>{busy ? "Saving…" : "Confirm authorization"}</Button></DialogContent></Dialog>
    <Dialog open={!!cancelling} onOpenChange={o => !busy && !o && setCancelling(null)}><DialogContent><DialogHeader><DialogTitle>Cancel prescription</DialogTitle><DialogDescription>The prescription and its medicines remain in the patient history.</DialogDescription></DialogHeader><F label="Cancellation / correction reason" required><Textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></F><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={cancel}>Confirm cancellation</Button></DialogContent></Dialog>
  </section>;
}