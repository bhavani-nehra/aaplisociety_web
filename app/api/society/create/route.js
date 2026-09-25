import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { authorize } from "@/lib/rbac/authorize";
import { matrixConfigSchema } from "@/lib/validators";

// SEC-21: converged off an inline `decoded.role !== "Admin"` check.
//
// Despite the path, this route does NOT create a society — it writes
// `matrixConfig` onto the caller's OWN society (note `findByIdAndUpdate` on the
// token's societyId below). The permission reflects what it actually does.
//
// The old check accepted any token whose literal role string was "Admin",
// regardless of what that user's RoleAssignment currently granted — so a
// handed-over admin kept write access to society config until their token
// happened to expire.
export async function POST(request) {
  const gate = await authorize(request, "society.config.update");
  if (!gate.ok) return gate.response;
  const { societyId } = gate.context;
  try {
    await connectDB();
    const body = await request.json();
    const validationResult = matrixConfigSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.errors },
        { status: 400 }
      );
    }
    const updatedSociety = await Society.findByIdAndUpdate(
      societyId,
      {
        $set: {
          matrixConfig: {
            L: validationResult.data.L,
            R: validationResult.data.R,
          },
          billingHeads: validationResult.data.billingHeads,
        },
      },
      { new: true, runValidators: true }
    );
    return NextResponse.json({
      message: "Matrix configuration saved successfully",
      society: updatedSociety,
    });
  } catch (error) {
    console.error("Matrix config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
