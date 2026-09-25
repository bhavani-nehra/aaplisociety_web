import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Transaction from '@/models/Transaction';
import Bill from '@/models/Bill';
import User from '@/models/User';
import AuditLog from '@/models/AuditLog';
import BillingHead from '@/models/BillingHead';
import Receipt from '@/models/Receipt';
import { requireRoles, SOCIETY_ADMIN_ROLES } from '@/lib/authz';
import { authorize } from '@/lib/rbac/authorize';
import { safeRegex } from '@/lib/query-safety';
const modelMap = {
  society: Society,
  members: Member,
  transactions: Transaction,
  bills: Bill,
  receipts: Receipt,
  users: User,
  auditlogs: AuditLog,
  billingheads: BillingHead
};
// GET - Fetch data with filters
export async function GET(request, { params }) {
  try {
    const gate = await authorize(request, "society.data.view");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const { entity } = await params; // ← AWAIT HERE
    const Model = modelMap[entity];
    if (!Model) {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
    }
    const searchParams = new URL(request.url).searchParams;
    const query = {};
    // Add societyId filter for all entities except society itself
    if (entity !== 'society') {
      query.societyId = decoded.societyId;
    } else {
      query._id = decoded.societyId;
    }
    // Apply filters based on search params
    if (searchParams.get('name')) {
      query.ownerName = safeRegex(searchParams.get('name'));
    }
    if (searchParams.get('status')) {
      if (entity === 'members') {
        query.membershipStatus = searchParams.get('status');
      } else if (entity === 'bills') {
        query.status = searchParams.get('status');
      }
    }
    if (searchParams.get('startDate') && searchParams.get('endDate')) {
      query.date = {
        $gte: new Date(searchParams.get('startDate')),
        $lte: new Date(searchParams.get('endDate'))
      };
    }
    if (searchParams.get('category')) {
      query.category = searchParams.get('category');
    }
    const data = await Model.find(query).lean();
    const total = await Model.countDocuments(query);
    return NextResponse.json({ success: true, data, total });
  } catch (error) {
    console.error('DB Manager GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
