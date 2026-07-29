/*
 * seed.js — Demo data for the Hospital Performance Dashboard.
 * This is fake, illustrative data. It is loaded once and then copied into
 * localStorage, after which the user's edits take over. Use "Reset demo data"
 * in the UI to restore this baseline.
 *
 * Metric glossary (per employee, for a rolling period e.g. last quarter):
 *   casesReferred   – cases routed to this clinician
 *   casesAccepted   – cases they took on (acceptance rate = accepted / referred)
 *   minorSurgeries  – count of minor procedures performed
 *   majorSurgeries  – count of major procedures performed
 *   surgerySuccess  – procedures with a good documented outcome
 *   surgeryFailure  – procedures with a complication / adverse outcome
 *   scansReported   – radiology reads / studies reported (radiology-relevant)
 *   avgTurnaroundHrs– avg hours from study to signed report (lower is better)
 *   satisfaction    – patient satisfaction, 1.0–5.0
 */

const SEED_DATA = {
  hospitalName: "Meridian Radiology & Surgical Institute",
  period: "Q2 2026",
  departments: [
    { id: "radiology",  name: "Radiology" },
    { id: "surgery",    name: "General Surgery" },
    { id: "cardiology", name: "Cardiology" },
    { id: "ortho",      name: "Orthopedics" },
    { id: "emergency",  name: "Emergency" },
  ],
  employees: [
    // Radiology (the hospital's specialty — richer scan volumes)
    { id: "e01", name: "Dr. Ananya Rao",       department: "radiology",  role: "Consultant Radiologist", casesReferred: 320, casesAccepted: 305, minorSurgeries: 40, majorSurgeries: 6,  surgerySuccess: 44, surgeryFailure: 2, scansReported: 1420, avgTurnaroundHrs: 9,  satisfaction: 4.7 },
    { id: "e02", name: "Dr. Marcus Lee",       department: "radiology",  role: "Radiologist",            casesReferred: 280, casesAccepted: 240, minorSurgeries: 28, majorSurgeries: 3,  surgerySuccess: 27, surgeryFailure: 4, scansReported: 1180, avgTurnaroundHrs: 14, satisfaction: 4.1 },
    { id: "e03", name: "Dr. Priya Nair",       department: "radiology",  role: "Interventional Rad.",    casesReferred: 210, casesAccepted: 200, minorSurgeries: 62, majorSurgeries: 18, surgerySuccess: 74, surgeryFailure: 6, scansReported: 640,  avgTurnaroundHrs: 11, satisfaction: 4.5 },
    { id: "e04", name: "Dr. Tobias Weber",     department: "radiology",  role: "Radiologist",            casesReferred: 190, casesAccepted: 132, minorSurgeries: 15, majorSurgeries: 2,  surgerySuccess: 12, surgeryFailure: 5, scansReported: 720,  avgTurnaroundHrs: 22, satisfaction: 3.4 },

    // General Surgery
    { id: "e05", name: "Dr. Sofia Alvarez",    department: "surgery",    role: "Consultant Surgeon",     casesReferred: 260, casesAccepted: 248, minorSurgeries: 90, majorSurgeries: 72, surgerySuccess: 152,surgeryFailure: 10,scansReported: 40,   avgTurnaroundHrs: 0,  satisfaction: 4.6 },
    { id: "e06", name: "Dr. James Okafor",     department: "surgery",    role: "Surgeon",                casesReferred: 230, casesAccepted: 205, minorSurgeries: 76, majorSurgeries: 55, surgerySuccess: 118,surgeryFailure: 13,scansReported: 20,   avgTurnaroundHrs: 0,  satisfaction: 4.2 },
    { id: "e07", name: "Dr. Hannah Cohen",     department: "surgery",    role: "Junior Surgeon",         casesReferred: 180, casesAccepted: 120, minorSurgeries: 48, majorSurgeries: 20, surgerySuccess: 58, surgeryFailure: 10,scansReported: 10,   avgTurnaroundHrs: 0,  satisfaction: 3.6 },

    // Cardiology
    { id: "e08", name: "Dr. Vikram Shah",      department: "cardiology", role: "Consultant Cardiologist",casesReferred: 240, casesAccepted: 231, minorSurgeries: 54, majorSurgeries: 30, surgerySuccess: 80, surgeryFailure: 4, scansReported: 210,  avgTurnaroundHrs: 6,  satisfaction: 4.8 },
    { id: "e09", name: "Dr. Elena Rossi",      department: "cardiology", role: "Cardiologist",           casesReferred: 200, casesAccepted: 168, minorSurgeries: 38, majorSurgeries: 16, surgerySuccess: 48, surgeryFailure: 6, scansReported: 150,  avgTurnaroundHrs: 9,  satisfaction: 4.0 },

    // Orthopedics
    { id: "e10", name: "Dr. Daniel Kim",       department: "ortho",      role: "Consultant Ortho.",      casesReferred: 220, casesAccepted: 210, minorSurgeries: 60, majorSurgeries: 48, surgerySuccess: 100,surgeryFailure: 8, scansReported: 180,  avgTurnaroundHrs: 7,  satisfaction: 4.5 },
    { id: "e11", name: "Dr. Grace Mensah",     department: "ortho",      role: "Ortho. Surgeon",         casesReferred: 190, casesAccepted: 150, minorSurgeries: 44, majorSurgeries: 28, surgerySuccess: 62, surgeryFailure: 10,scansReported: 90,   avgTurnaroundHrs: 12, satisfaction: 3.8 },

    // Emergency
    { id: "e12", name: "Dr. Omar Farouk",      department: "emergency",  role: "ER Consultant",          casesReferred: 410, casesAccepted: 398, minorSurgeries: 120,majorSurgeries: 22, surgerySuccess: 132,surgeryFailure: 10,scansReported: 260,  avgTurnaroundHrs: 5,  satisfaction: 4.3 },
    { id: "e13", name: "Dr. Lucia Bianchi",    department: "emergency",  role: "ER Physician",           casesReferred: 380, casesAccepted: 300, minorSurgeries: 95, majorSurgeries: 14, surgerySuccess: 96, surgeryFailure: 13,scansReported: 200,  avgTurnaroundHrs: 8,  satisfaction: 3.9 },
  ],
};
