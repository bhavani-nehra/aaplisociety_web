import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { parseFirstSheet } from "@/lib/excelParse";
import { escapeRegex } from "@/lib/query-safety";
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Form data required" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!file) {
    return NextResponse.json({ error: "Excel file required" }, { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let rows;
  try {
    rows = await parseFirstSheet(buffer, { defval: "" });
  } catch (e) {
    return NextResponse.json({ error: "Invalid Excel file" }, { status: 400 });
  }
  const conflicts = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row["Admin Email"] || row["Admin Email*"] || row["email"] || "").toString().trim();
    const registrationNo = (row["Registration No"] || row["Registration No*"] || row["registrationNo"] || "").toString().trim();
    const societyName = (row["Society Name"] || row["Society Name*"] || row["societyName"] || "").toString().trim();
    if (email) {
      const existingUser = await User.findOne({ email: email.toLowerCase() }).lean();
      if (existingUser)
        conflicts.push({ rowIndex: i, field: "Admin Email*", message: `Email already registered: "${email}"` });
    }
    if (registrationNo) {
      const existingSoc = await Society.findOne({ registrationNo, isDeleted: { $ne: true } }).lean();
      if (existingSoc)
        conflicts.push({ rowIndex: i, field: "Registration No*", message: `Registration No already exists: "${registrationNo}"` });
    }
    if (societyName) {
      const existingName = await Society.findOne({
        name: new RegExp(`^${escapeRegex(societyName)}$`, "i"),
        isDeleted: { $ne: true },
      }).lean();
      if (existingName)
        conflicts.push({ rowIndex: i, field: "Society Name*", message: `Society name already exists: "${societyName}"` });
    }
  }
  return NextResponse.json({ conflicts });
}
