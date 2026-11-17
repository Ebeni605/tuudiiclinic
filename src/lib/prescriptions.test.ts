import { describe, expect, it } from "vitest";
import { authorizationProblems, canEditPrescription, canPrintPrescription, emptyMedicine } from "./prescriptions";

describe("prescription authorization", () => {
  it("allows only the prescribing clinician to edit a draft", () => {
    expect(canEditPrescription("a", true, { clinician_id: "a", status: "draft" })).toBe(true);
    expect(canEditPrescription("b", true, { clinician_id: "a", status: "draft" })).toBe(false);
    expect(canEditPrescription("a", false, { clinician_id: "a", status: "draft" })).toBe(false);
    expect(canEditPrescription("a", true, { clinician_id: "a", status: "finalized" })).toBe(false);
  });
  it("never permits printing drafts or cancelled prescriptions", () => {
    expect(canPrintPrescription({ status: "draft" })).toBe(false);
    expect(canPrintPrescription({ status: "cancelled" })).toBe(false);
    expect(canPrintPrescription({ status: "finalized" })).toBe(true);
    expect(canPrintPrescription({ status: "printed" })).toBe(true);
  });
  const complete = { ...emptyMedicine(), drug_name: "Fictional medicine", dose: "1 unit", route: "Oral", frequency: "Once", duration: "1 day", quantity: "1" };
  it("requires a diagnosis", () => expect(authorizationProblems([complete], "", "MD", "TEST")).toContain("Select an encounter diagnosis."));
  it("requires administrator-confirmed credentials", () => expect(authorizationProblems([complete], "dx", "", "").length).toBe(1));
  it("requires between one and fifty medicines", () => {
    expect(authorizationProblems([], "dx", "MD", "TEST")).toContain("Enter between 1 and 50 medicines.");
    expect(authorizationProblems(Array.from({ length: 50 }, () => complete), "dx", "MD", "TEST")).toEqual([]);
    expect(authorizationProblems(Array.from({ length: 51 }, () => complete), "dx", "MD", "TEST")).toContain("Enter between 1 and 50 medicines.");
  });
  it("requires dose, route, frequency, duration and quantity", () => {
    expect(authorizationProblems([complete], "dx", "MD", "TEST")).toEqual([]);
    for (const field of ["dose", "route", "frequency", "duration", "quantity"] as const) expect(authorizationProblems([{ ...complete, [field]: "" }], "dx", "MD", "TEST").length).toBe(1);
  });
});