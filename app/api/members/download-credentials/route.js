import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import jwt from 'jsonwebtoken';
import { authorize } from "@/lib/rbac/authorize";
// Auth: admin_token cookie (superadmin) or regular JWT cookie (admin/member)
export async function POST(request) {
  try {
    const gate = await authorize(request, "member.member.downloadCredentials");
    if (!gate.ok) return gate.response;
    // Accept: regular JWT (admin/member cookie) OR superadmin admin_token cookie
    const adminToken = request.cookies.get("admin_token")?.value;
    const regularToken = getTokenFromRequest(request);
    let authorized = false;
    if (regularToken && verifyToken(regularToken)) {
      authorized = true;
    } else if (adminToken) {
      // SEC-17: this used to fall back to JWT_SECRET when ADMIN_JWT_SECRET was
      // unset. In any environment missing the admin secret, an ORDINARY user
      // token — signed with JWT_SECRET — verified as a superadmin token. Fails
      // closed now, matching lib/authz.js:requireSuperAdmin which already
      // refuses when the secret is absent rather than borrowing another one.
      const adminSecret = process.env.ADMIN_JWT_SECRET;
      if (!adminSecret) {
        console.error("ADMIN_JWT_SECRET is not configured");
      } else {
        try {
          const decoded = jwt.verify(adminToken, adminSecret);
          // Verifying the signature only proved the token is ours. The role is
          // what makes it a superadmin token.
          if (decoded?.role === "SuperAdmin") authorized = true;
        } catch { /* invalid */ }
      }
    }
    if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { credentials } = await request.json();
    if (!credentials || credentials.length === 0) {
      return NextResponse.json({ error: 'No credentials provided' }, { status: 400 });
    }
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('User Credentials');
    // Add header with styling
    worksheet.columns = [
      { header: 'Flat No', key: 'flatNo', width: 12 },
      { header: 'Wing', key: 'wing', width: 10 },
      { header: 'Owner Name', key: 'ownerName', width: 30 },
      { header: 'Username', key: 'username', width: 25 },
      { header: 'Email', key: 'email', width: 35 },
      // SEC-16: the 'Password' column is gone. It carried the plaintext
      // password for every member in the sheet, which then left the building
      // by email and WhatsApp. The Setup Link below does the same job — the
      // member sets their own password — without anything recoverable ending
      // up in a forwarded file.
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Setup Link', key: 'setCredentialsUrl', width: 70 },
    ];
    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    // Add data
    credentials.forEach(cred => {
      worksheet.addRow({
        flatNo: cred.flatNo,
        wing: cred.wing || '',
        ownerName: cred.ownerName,
        username: cred.username || '',
        email: cred.email,
       status: cred.isNewUser ? 'New Account' : 'Existing Account',
  setCredentialsUrl: cred.setCredentialsUrl || '',
});
    });
    // Add instructions at the bottom
    worksheet.addRow([]);
const instructionRow = worksheet.addRow(['INSTRUCTIONS:', '', '', '', '', '', '', '']);
    instructionRow.font = { bold: true, color: { argb: 'FFDC2626' } };
    worksheet.addRow(['1. Send each member their own Setup Link. They choose their own password.']);
    worksheet.addRow(['2. This file contains NO passwords — a setup link is the only way in.']);
    worksheet.addRow(['3. "Existing Account" rows already have a password; they need no setup link.']);
    worksheet.addRow(['4. Members log in with Username (or email) + the password they set.']);
    worksheet.addRow(['5. Setup links expire 7 days after import — re-import or resend if they lapse.']);
    worksheet.addRow(['6. A setup link is single-use. Do not post it in a shared group.']);
    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    // Return as downloadable file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=User_Credentials_${Date.now()}.xlsx`
      }
    });
  } catch (error) {
    console.error('Download credentials error:', error);
    return NextResponse.json({ 
      error: 'Download failed' 
    }, { status: 500 });
  }
}
