"use client";
import { Printer } from "lucide-react";
export function PrintReportButton() { return <button className="print-report-button" onClick={() => window.print()}><Printer size={17} />Save as PDF</button>; }
