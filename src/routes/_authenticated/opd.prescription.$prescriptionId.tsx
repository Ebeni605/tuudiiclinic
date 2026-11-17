import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Printer, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CLINIC, ClinicLogo } from "@/components/ClinicBrand";
import { LoadError } from "@/components/AppShell";
import { requireArea, useStaff } from "@/lib/auth";
import { canPrintPrescription, prescriptionQuery } from "@/lib/prescriptions";
import { fmtDate, fmtDateTime } from "@/lib/opd-queries";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/opd/prescription/$prescriptionId")({
  beforeLoad: requireArea("opd"),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(prescriptionQuery(params.prescriptionId)),
  head: () => ({ meta: [
    { title: "Prescription — Two D Medium Clinic" }, { name: "description", content: "Clinic-branded A4 prescription and authorization record." },
    { property: "og:title", content: "Prescription — Two D Medium Clinic" }, { property: "og:description", content: "Clinic-branded A4 prescription and authorization record." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: PrescriptionPage,
});

function PrescriptionPage() {
  const { prescriptionId } = Route.useParams();
  const { data: r } = useSuspenseQuery(prescriptionQuery(prescriptionId));
  const { data: me } = useStaff();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!r) return <LoadError message="Prescription not found or access unavailable." />;
  const snapshot = object(r.snapshot);
  const patient = object(snapshot["patient"]);
  const prescriber = object(snapshot["prescriber"]);
  const diagnosis = object(snapshot["diagnosis"]);
  const authorized = canPrintPrescription(r);
  const canPrint = authorized && me?.id === r.clinician_id && me.roles.includes("clinician");
  const name = [patient["first_name"], patient["middle_name"], patient["last_name"]].filter(Boolean).join(" ");
  async function print(pdf = false) {
    if (!r || !canPrint) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("prescription_action", { _id: r.id, _action: pdf ? "pdf_download_requested" : "print_requested" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["prescription", r.id] });
      await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => undefined)));
      await document.fonts.ready;
      window.print();
    } catch (e) { toast.error((e as { message: string }).message); }
    finally { setBusy(false); }
  }
  return <div>
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
      <Button asChild variant="outline"><Link to="/opd/visit/$visitId" params={{ visitId: r.visit_id }}><ArrowLeft className="mr-2 h-4 w-4" />Encounter</Link></Button>
      <div className="flex flex-wrap gap-2"><Button disabled={!canPrint || busy} onClick={() => print()}><Printer className="mr-2 h-4 w-4" />Print A4</Button><Button variant="outline" disabled={!canPrint || busy} onClick={() => print(true)}><FileDown className="mr-2 h-4 w-4" />Save as PDF</Button></div>
    </div>
    <p className="no-print mb-4 text-sm text-muted-foreground">{!authorized ? "Draft or cancelled prescriptions cannot be printed." : !canPrint ? "Only the prescribing clinician may request printing." : "For a PDF, choose Save as PDF in the print dialog."}</p>
    <article className={`prescription-paper print-area a4-page mx-auto border bg-card p-5 text-sm shadow-sm sm:p-8 ${authorized ? "" : "prescription-unprintable"}`}>
      <table className="rx-frame w-full border-collapse"><thead><tr><td className="p-0">
      <header className="prescription-header flex items-center gap-4 border-b-2 border-primary pb-4">
        <ClinicLogo className="h-16 w-16 shrink-0" /><div className="min-w-0 flex-1 text-center"><h1 className="text-base font-bold text-primary">{CLINIC.name}</h1><p>{CLINIC.amharic}</p><p className="font-semibold">{CLINIC.english}</p><p className="text-xs">Tel: {text(snapshot["phones"]) || CLINIC.phones}</p>{text(snapshot["clinic_address"]) && <p className="text-xs">{text(snapshot["clinic_address"])}</p>}</div>
      </header>
        <p className="rx-running mt-1 flex flex-wrap justify-between gap-2 border-b pb-1 text-xs"><span><b>Rx:</b> {r.prescription_number}</span><span><b>Patient:</b> {name || "—"} · {text(patient["mrn"])}</span></p>
      </td></tr></thead><tbody><tr><td className="p-0">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold text-primary">Medical Prescription</h2><span className={authorized ? "font-semibold text-primary" : "font-bold text-destructive"}>{authorized ? "AUTHORIZED" : r.status.toUpperCase()}</span></div>
      <p className="mt-1 break-all font-mono text-xs">{r.prescription_number}</p>
      <dl className="my-4 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 prescription-details">
        <Detail label="Patient name" value={name} /><Detail label="Patient / card no." value={text(patient["mrn"])} />
        <Detail label="Age" value={text(snapshot["age"])} /><Detail label="Sex" value={text(patient["sex"])} />
        <Detail label="Phone" value={text(patient["phone"])} /><Detail label="Department" value={`OPD${text(snapshot["service_name"]) ? " – " + text(snapshot["service_name"]) : ""}`} />
        <Detail label="Clinician" value={text(prescriber["full_name"])} /><Detail label="Prescription date" value={fmtDate(r.finalized_at ?? r.created_at)} />
        <Detail label="Weight" value={snapshot["weight_kg"] != null ? `${text(snapshot["weight_kg"])} kg` : ""} /><Detail label="Care type" value={text(snapshot["care_type"])} />
        <Detail label="Region / town" value={[patient["region"], patient["town"]].filter(Boolean).join(" / ")} /><Detail label="Visit date" value={fmtDate(text(snapshot["visit_date"]))} />
      </dl>
      <p className="border-y py-2"><b>Diagnosis:</b> {text(diagnosis["description"]) || "—"}{diagnosis["icd10_code"] ? ` (${text(diagnosis["icd10_code"])})` : ""}</p>
      <div className="my-4 text-3xl font-serif font-bold text-primary">℞</div>
      <div className="overflow-x-auto prescription-table-wrap"><table className="prescription-table w-full table-fixed border-collapse text-xs"><colgroup><col className="w-[6%]" /><col className="w-[24%]" /><col className="w-[15%]" /><col className="w-[19%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[14%]" /></colgroup>
        <thead><tr className="bg-secondary text-left"><th>No.</th><th>Medicine</th><th>Strength</th><th>Dosage / route</th><th>Frequency</th><th>Duration</th><th>Quantity</th></tr></thead>
        <tbody>{[...r.prescription_items].sort((a,b) => a.position-b.position).map(m => <tr key={m.id}><td>{m.position}</td><td><b>{m.drug_name}</b>{m.brand_name && <div>{m.brand_name}</div>}{m.dosage_form && <div>{m.dosage_form}</div>}</td><td>{m.strength || "—"}</td><td>{m.dose || "—"}<div>{m.route}</div></td><td>{m.frequency || "—"}</td><td>{m.duration || "—"}</td><td>{m.quantity || "—"}</td></tr>)}</tbody>
      </table></div>
      <section className="prescription-instructions mt-5"><h3 className="border-b border-primary pb-1 font-semibold text-primary">Additional instructions</h3>{(() => { const lines = [...r.prescription_items].sort((a,b) => a.position-b.position).flatMap(m => [m.instructions, m.other_information].filter(Boolean).map(t => `${m.position}. ${m.drug_name}: ${t}`)); return lines.length ? <ul className="mt-2 space-y-1 whitespace-pre-wrap">{lines.map(l => <li key={l}>{l}</li>)}</ul> : <p className="mt-2 text-muted-foreground">—</p>; })()}</section>
      {r.cancel_reason && <p className="mt-4 text-destructive"><b>Cancelled:</b> {r.cancel_reason}</p>}
      <div className="prescription-signatures mt-8 grid gap-6 sm:grid-cols-2">
        <section className="space-y-2"><h3 className="border-b border-primary pb-1 font-semibold text-primary">Prescriber</h3><p><b>Full name:</b> {text(prescriber["full_name"]) || "—"}</p><p><b>Registration:</b> {text(prescriber["professional_registration"]) || "—"}</p><p><b>Designation:</b> {text(prescriber["qualification"]) || "—"}</p><p><b>Authorized:</b> {fmtDateTime(r.finalized_at)}</p><p className="pt-6">Signature: ____________________</p></section>
        <section className="space-y-2"><h3 className="border-b border-primary pb-1 font-semibold text-primary">Dispenser</h3><p>Full name: ____________________</p><p>Qualification: __________________</p><p>Registration: __________________</p><p>Date: ________________________</p><p className="pt-6">Signature: ____________________</p></section>
      </div>
      </td></tr></tbody></table>
      <p className="mt-8 border-t pt-3 text-center text-xs text-muted-foreground">{CLINIC.english} · {r.prescription_number}</p>
    </article>
    <section className="no-print mx-auto mt-6 max-w-3xl"><h2 className="mb-3 font-semibold">Authorization &amp; print history</h2><ul className="space-y-2 text-sm">{[...r.prescription_events].sort((a,b) => a.created_at.localeCompare(b.created_at)).map(e => <li key={e.id} className="border-b pb-2"><span className="capitalize">{e.action.replaceAll("_", " ")}</span> · {fmtDateTime(e.created_at)}{e.reason && <p className="break-all text-muted-foreground">{e.reason}</p>}</li>)}</ul></section>
  </div>;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="flex gap-2"><dt className="shrink-0 font-semibold">{label}:</dt><dd className="break-words">{value || "—"}</dd></div>; }