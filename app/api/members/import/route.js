// app/api/members/import/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import User from "@/models/User";
import Society from "@/models/Society";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import AuditLog from "@/models/AuditLog";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { generatePassword } from "@/lib/password-generator";
import { generateSimpleUsername, buildUsernameBloomFilter } from "@/lib/username-generator";
import { ensureSocietyCode } from "@/lib/society-code";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { signToken } from "@/lib/jwt";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
async function upsertMemberUser({
  memberDoc,
  basic,
  societyId,
  societyName,
  societyCode,
  bloom,
  plainPassword,
}) {
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  const email = basic.emailPrimary?.trim().toLowerCase() || null;
  const phone = String(basic.contactNumber || "").trim() || null;
  const whatsapp = String(basic.whatsappNumber || "").trim() || null;
  const newProfile = {
    profileId: new mongoose.Types.ObjectId(),
    societyId,
    memberId: memberDoc._id,
    role: "Member",
    flatNo: basic.flatNo ?? memberDoc.flatNo ?? "",
    wing: basic.wing ?? memberDoc.wing ?? "",
    societyName: societyName ?? "",
    isPrimary: false,
    status: "Active",
    joinedAt: new Date(),
  };
  // Check existing user by email OR phone
  const lookupConditions = [];
  if (email) lookupConditions.push({ email });
  if (phone) lookupConditions.push({ phone });
  if (whatsapp) lookupConditions.push({ phone: whatsapp });
  const existingUser = lookupConditions.length
    ? await User.findOne({ $or: lookupConditions })
    : null;
  let targetUser;
  if (existingUser) {
    // Existing user → append profile only (keep their password)
    newProfile.isPrimary = false;
    const alreadyLinked = existingUser.profiles?.some(
      (p) =>
        String(p.societyId) === String(societyId) &&
        String(p.memberId) === String(memberDoc._id),
    );
    if (!alreadyLinked) {
      await User.updateOne(
        { _id: existingUser._id },
        { $push: { profiles: newProfile } },
      );
    }
    targetUser = existingUser;
  } else {
    // New user → create with first profile
    newProfile.isPrimary = true;
    const username = await generateSimpleUsername(societyCode, basic.flatNo, bloom);
    targetUser = await User.create({
      name: basic.ownerName,
      username,
      email: email || undefined,
      phone: phone || undefined,
      password: hashedPassword,
      role: "Member",
      profiles: [newProfile],
      activeProfileId: newProfile.profileId,
      isActive: true,
      mustChangePassword: true,
    });
  }
  // Backlink member → user
  await Member.updateOne({ _id: memberDoc._id }, { userId: targetUser._id });
  return { user: targetUser, profile: newProfile, isNew: !existingUser };
}
export async function POST(request) {
  try {
    const gate = await authorize(request, "member.member.import");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const formData = await request.formData();
    const file = formData.get("file");
    const confirmImport = formData.get("confirmImport"); // ← NEW: Check if confirm
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const firstSheet = workbook.worksheets[0];
    const isEnhancedTemplate = firstSheet.name.includes("Basic Info");
    // ========== MODE 1: PREVIEW (Default) ==========
    if (confirmImport !== "true") {
      // Save temp file for later
      const tempDir = join(process.cwd(), "temp");
      try {
        await mkdir(tempDir, { recursive: true });
      } catch (e) {}
      const tempFilePath = join(tempDir, `temp-import-${Date.now()}.xlsx`);
      await writeFile(tempFilePath, buffer);
      // Parse and validate
      const validation = await validateImportData(
        workbook,
        decoded.societyId,
        isEnhancedTemplate,
      );
      // Parse sheets for preview
      const sheets = {};
      workbook.worksheets.forEach((sheet) => {
        const rows = [];
        sheet.eachRow((row, rowNumber) => {
          const cells = [];
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cells.push({
              value: cell.value,
              address: cell.address,
              row: rowNumber,
              col: colNumber,
            });
          });
          rows.push(cells);
        });
        sheets[sheet.name] = rows;
      });
      return NextResponse.json({
        mode: "preview",
        tempFilePath,
        sheets,
        validation,
        isEnhancedTemplate,
      });
    }
    // ========== MODE 2: CONFIRM & IMPORT ==========
    if (confirmImport === "true") {
      if (isEnhancedTemplate) {
        return await handleEnhancedImport(workbook, decoded);
      } else {
        return await handleSimpleImport(workbook, decoded);
      }
    }
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      {
        error: "Import failed",
      },
      { status: 500 },
    );
  }
}
// ========== VALIDATION FUNCTION ==========
async function validateImportData(workbook, societyId, isEnhanced) {
  const issues = [];
  const validCount = { valid: 0, errors: 0, warnings: 0, duplicates: 0 };
  const basicSheet = workbook.getWorksheet(
    isEnhanced ? "1. Basic Info (Required)" : workbook.worksheets[0].name,
  );
  if (!basicSheet) {
    return {
      issues: [{ type: "CRITICAL", message: "Basic Info sheet not found" }],
      validCount,
      summary: { canImport: false },
    };
  }
  // Get existing members for duplicate check
  const existingMembers = await Member.find({ societyId }).lean();
  const existingFlats = new Set(
    existingMembers.map((m) => `${m.wing || ""}-${m.flatNo}`),
  );
  // Map email/phone → ownerName so same person with multiple flats is allowed
  const existingEmailOwner = new Map(existingMembers.map((m) => [m.emailPrimary, m.ownerName]));
  const existingPhoneOwner = new Map(existingMembers.map((m) => [String(m.contactNumber || ""), m.ownerName]));
  const existingEmails = new Set(existingMembers.map((m) => m.emailPrimary));
  const existingPhones = new Set(existingMembers.map((m) => String(m.contactNumber || "")));
  const existingPANOwner = new Map(existingMembers.filter(m => m.panCard).map((m) => [m.panCard, m.ownerName]));
  // existingAadhaarOwner is gone with D1 — Aadhaar is no longer a
  // de-duplication key, because it is no longer stored.
  // Build parking slots lookup
  const existingParkingSlots = new Set();
  existingMembers.forEach((m) => {
    (m.parkingSlots || []).forEach((ps) => {
      if (ps && ps.slotNumber) existingParkingSlots.add(ps.slotNumber);
    });
  });
  // Build family members lookup
  const existingFamilyMembers = new Set();
  existingMembers.forEach((m) => {
    const flatKey = `${m.wing || ""}-${m.flatNo}`;
    (m.familyMembers || []).forEach((fm) => {
      if (fm && fm.name)
        existingFamilyMembers.add(`${flatKey}|||${fm.name.toLowerCase()}`);
    });
  });
  // Build owner history lookup
  const existingOwnerHistory = new Set();
  existingMembers.forEach((m) => {
    const flatKey = `${m.wing || ""}-${m.flatNo}`;
    (m.ownerHistory || []).forEach((oh) => {
      if (oh && oh.ownerName) {
        existingOwnerHistory.add(`${flatKey}|||${oh.ownerName.toLowerCase()}`);
        if (oh.panCard)
          existingOwnerHistory.add(`${flatKey}|||PAN|||${oh.panCard}`);
      }
    });
  });
  // Build tenant history lookup
  const existingTenantHistory = new Set();
  existingMembers.forEach((m) => {
    const flatKey = `${m.wing || ""}-${m.flatNo}`;
    (m.tenantHistory || []).forEach((th) => {
      if (th && th.tenantName) {
        existingTenantHistory.add(
          `${flatKey}|||${th.tenantName.toLowerCase()}`,
        );
        if (th.panCard)
          existingTenantHistory.add(`${flatKey}|||PAN|||${th.panCard}`);
      }
    });
  });
  // Parse headers
  const headerRow = basicSheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    headers.push(
      String(cell.value ?? "")
        .trim()
        .replace(/\*/g, ""),
    );
  });
  // Build flatNo to wing mapping from Sheet 1
  const flatWingMap = {};
  basicSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowData = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) rowData[header] = cell.value;
    });
    const flatNo = String(rowData["flatNo"] || "").trim();
    const wing = String(rowData["wing"] || "").trim();
    if (flatNo && flatNo !== "INSTRUCTIONS:") {
      flatWingMap[flatNo] = wing;
    }
  });
  // Track duplicates within file — Maps store email/phone → ownerName to allow same person multi-flat
  const fileFlats = new Set();
  const fileEmailOwnerFile = new Map();
  const filePhoneOwnerFile = new Map();
  const filePANs = new Map(); // panCard → ownerName
  const flatOwnerMap = new Map(); // flatNo → ownerName (populated in sheet 1, used in sheet 2)
  const fileParkingSlots = new Set();
  const fileFamilyMembers = new Set();
  const fileOwnerHistory = new Set();
  const fileTenantHistory = new Set();
  // ========== VALIDATE SHEET 1: BASIC INFO ==========
  basicSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowData = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        rowData[header] = cell.value;
      }
    });
    const flatNo = String(rowData["flatNo"] || "").trim();
    const wing = String(rowData["wing"] || "").trim();
    const floor = rowData["floor"];
    const ownerName = String(rowData["ownerName"] || "").trim();
    const contactNumber = String(rowData["contactNumber"] || "").trim();
    const emailPrimary = String(rowData["emailPrimary"] || "").trim();
    const carpetAreaSqft = rowData["carpetAreaSqft"];
    const flatType = String(rowData["flatType"] || "").trim();
    const ownershipType = String(rowData["ownershipType"] || "").trim();
    const openingPrincipal = rowData["openingPrincipal"];
    const openingInterest = rowData["openingInterest"];
    if (!flatNo || flatNo === "INSTRUCTIONS:") return;
    // Track flatNo → ownerName for sheet 2 PAN/Aadhaar same-person check
    if (ownerName) flatOwnerMap.set(flatNo, ownerName);
    const cellIssues = {};
    // 1. flatNo validation
    if (!flatNo) {
      cellIssues["flatNo"] = {
        type: "ERROR",
        message: "Flat number is required",
      };
      validCount.errors++;
    } else {
      const flatKey = `${wing}-${flatNo}`;
      if (existingFlats.has(flatKey)) {
        cellIssues["flatNo"] = {
          type: "DUPLICATE_DB",
          message: `Flat ${flatKey} already exists in database`,
        };
        validCount.duplicates++;
      } else if (fileFlats.has(flatKey)) {
        cellIssues["flatNo"] = {
          type: "DUPLICATE_FILE",
          message: `Duplicate flat ${flatKey} in this file`,
        };
        validCount.duplicates++;
      } else {
        fileFlats.add(flatKey);
      }
    }
    // 2. wing validation
    if (!wing) {
      cellIssues["wing"] = {
        type: "WARNING",
        message: "Wing not specified (will be empty)",
      };
      validCount.warnings++;
    }
    // 3. floor validation
    // if (!floor && floor !== 0) {
    //   cellIssues["floor"] = {
    //     type: "ERROR",
    //     message: "Floor number is required",
    //   };
    //   validCount.errors++;
    // } else if (floor < -2 || floor > 50) {
    //   cellIssues["floor"] = {
    //     type: "ERROR",
    //     message: "Floor number must be between -2 and 50",
    //   };
    //   validCount.errors++;
    // }
    // 4. ownerName validation
    if (!ownerName) {
      cellIssues["ownerName"] = {
        type: "ERROR",
        message: "Owner name is required",
      };
      validCount.errors++;
    } else if (ownerName.length < 2) {
      cellIssues["ownerName"] = {
        type: "ERROR",
        message: "Owner name must be at least 2 characters",
      };
      validCount.errors++;
    } else if (!/^[a-zA-Z\s.]+$/.test(ownerName)) {
      cellIssues["ownerName"] = {
        type: "ERROR",
        message: "Owner name can only contain letters and spaces",
      };
      validCount.errors++;
    }
    // 5. contactNumber validation
    if (!contactNumber) {
      cellIssues["contactNumber"] = {
        type: "ERROR",
        message: "Contact number is required",
      };
      validCount.errors++;
    } else {
      const phoneDigits = contactNumber.replace(/\D/g, "");
      if (phoneDigits.length !== 10) {
        cellIssues["contactNumber"] = {
          type: "ERROR",
          message: "Contact must be exactly 10 digits",
        };
        validCount.errors++;
      } else if (existingPhones.has(contactNumber) && existingPhoneOwner.get(contactNumber) !== ownerName) {
        cellIssues["contactNumber"] = {
          type: "DUPLICATE_DB",
          message: "Phone already exists in database for a different person",
        };
        validCount.duplicates++;
      } else if (filePhoneOwnerFile.has(contactNumber) && filePhoneOwnerFile.get(contactNumber) !== ownerName) {
        cellIssues["contactNumber"] = {
          type: "DUPLICATE_FILE",
          message: "Duplicate phone in file for a different person",
        };
        validCount.duplicates++;
      } else {
        filePhoneOwnerFile.set(contactNumber, ownerName);
      }
    }
    // 6. emailPrimary validation
    if (!emailPrimary) {
      cellIssues["emailPrimary"] = {
        type: "ERROR",
        message: "Email is required",
      };
      validCount.errors++;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPrimary)) {
      cellIssues["emailPrimary"] = {
        type: "ERROR",
        message: "Invalid email format",
      };
      validCount.errors++;
    } else if (existingEmails.has(emailPrimary) && existingEmailOwner.get(emailPrimary) !== ownerName) {
      cellIssues["emailPrimary"] = {
        type: "DUPLICATE_DB",
        message: "Email already exists in database for a different person",
      };
      validCount.duplicates++;
    } else if (fileEmailOwnerFile.has(emailPrimary) && fileEmailOwnerFile.get(emailPrimary) !== ownerName) {
      cellIssues["emailPrimary"] = {
        type: "DUPLICATE_FILE",
        message: "Duplicate email in file for a different person",
      };
      validCount.duplicates++;
    } else {
      fileEmailOwnerFile.set(emailPrimary, ownerName);
    }
    // 7. carpetAreaSqft validation
    if (!carpetAreaSqft || carpetAreaSqft <= 0) {
      cellIssues["carpetAreaSqft"] = {
        type: "ERROR",
        message: "Valid carpet area required (must be > 0)",
      };
      validCount.errors++;
    } else if (carpetAreaSqft < 100 || carpetAreaSqft > 10000) {
      cellIssues["carpetAreaSqft"] = {
        type: "WARNING",
        message: "Unusual area size (too small or too large)",
      };
      validCount.warnings++;
    }
    // 8. flatType validation
    // const validFlatTypes = [
    //   "1RK",
    //   "1BHK",
    //   "2BHK",
    //   "3BHK",
    //   "4BHK",
    //   "5BHK+",
    //   "Penthouse",
    //   "Studio",
    // ];
    // if (!flatType) {
    //   cellIssues["flatType"] = {
    //     type: "WARNING",
    //     message: "Flat type not specified (default: 2BHK)",
    //   };
    //   validCount.warnings++;
    // } else if (!validFlatTypes.includes(flatType)) {
    //   cellIssues["flatType"] = {
    //     type: "ERROR",
    //     message: `Invalid flat type. Must be one of: ${validFlatTypes.join(", ")}`,
    //   };
    //   validCount.errors++;
    // }
    // 9. ownershipType validation
    const validOwnershipTypes = [
      "Owner-Occupied",
      "Rented",
      "Vacant",
      "Under-Dispute",
    ];
    if (!ownershipType) {
      cellIssues["ownershipType"] = {
        type: "WARNING",
        message: "Ownership type not specified (default: Owner-Occupied)",
      };
      validCount.warnings++;
    } else if (!validOwnershipTypes.includes(ownershipType)) {
      cellIssues["ownershipType"] = {
        type: "ERROR",
        message: `Invalid ownership type: "${ownershipType}". Must be: ${validOwnershipTypes.join(", ")}`,
      };
      validCount.errors++;
    }
    // 10. openingPrincipal validation
    if (
      openingPrincipal !== null &&
      openingPrincipal !== undefined &&
      openingPrincipal !== ""
    ) {
      const val = Number(openingPrincipal);
      if (isNaN(val)) {
        cellIssues["openingPrincipal"] = {
          type: "ERROR",
          message: "Opening principal must be a number",
        };
        validCount.errors++;
      } else if (val < 0) {
        cellIssues["openingPrincipal"] = {
          type: "ERROR",
          message: "Opening principal cannot be negative",
        };
        validCount.errors++;
      } else if (val > 5000000) {
        cellIssues["openingPrincipal"] = {
          type: "WARNING",
          message: "Opening principal seems unusually high (> ₹50L) — verify",
        };
        validCount.warnings++;
      }
    }
    // 11. openingInterest validation
    if (
      openingInterest !== null &&
      openingInterest !== undefined &&
      openingInterest !== ""
    ) {
      const val = Number(openingInterest);
      if (isNaN(val)) {
        cellIssues["openingInterest"] = {
          type: "ERROR",
          message: "Opening interest must be a number",
        };
        validCount.errors++;
      } else if (val < 0) {
        cellIssues["openingInterest"] = {
          type: "ERROR",
          message: "Opening interest cannot be negative",
        };
        validCount.errors++;
      } else if (val > 1000000) {
        cellIssues["openingInterest"] = {
          type: "WARNING",
          message: "Opening interest seems unusually high (> ₹10L) — verify",
        };
        validCount.warnings++;
      }
    }
    if (Object.keys(cellIssues).length === 0) {
      validCount.valid++;
    }
    if (Object.keys(cellIssues).length > 0) {
      issues.push({
        sheet: basicSheet.name,
        row: rowNumber,
        flatNo,
        cellIssues,
      });
    }
  });
  // ========== VALIDATE SHEET 2: ADDITIONAL DETAILS ==========
  if (isEnhanced) {
    const detailsSheet = workbook.getWorksheet("2. Additional Details");
    if (detailsSheet) {
      detailsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flatNo = String(row.getCell(1).value || "").trim();
        if (!flatNo || flatNo === "INSTRUCTIONS:") return;
        const panCard = String(row.getCell(2).value || "").trim();
        const aadhaar = String(row.getCell(3).value || "").trim();
        const alternateContact = String(row.getCell(4).value || "").trim();
        const whatsappNumber = String(row.getCell(5).value || "").trim();
        const emailSecondary = String(row.getCell(6).value || "").trim();
        const builtUpAreaSqft = row.getCell(7).value;
        const possessionDate = row.getCell(8).value;
        const cellIssues = {};
        // 1. PAN validation
        const rowOwnerName = flatOwnerMap.get(flatNo) ?? "";
        if (panCard) {
          if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panCard)) {
            cellIssues["panCard"] = {
              type: "ERROR",
              message: "Invalid PAN format (e.g., ABCDE1234F)",
            };
            validCount.errors++;
          } else if (existingPANOwner.has(panCard) && existingPANOwner.get(panCard) !== rowOwnerName) {
            cellIssues["panCard"] = {
              type: "DUPLICATE_DB",
              message: "PAN already exists in database for a different person",
            };
            validCount.duplicates++;
          } else if (filePANs.has(panCard) && filePANs.get(panCard) !== rowOwnerName) {
            cellIssues["panCard"] = {
              type: "DUPLICATE_FILE",
              message: "Duplicate PAN in file for a different person",
            };
            validCount.duplicates++;
          } else {
            filePANs.set(panCard, rowOwnerName);
          }
        }
        // 2. Aadhaar — no longer collected (D1)
        //
        // This used to validate the 12 digits and enforce uniqueness across
        // members, which made Aadhaar a de-duplication key in the member
        // master. That is the sharpest possible use of it: it means the number
        // is stored, indexed, compared, and present in every backup, in a
        // system whose actual job is maintenance billing.
        //
        // The Aadhaar Act s.29 restricts sharing an Aadhaar number and forbids
        // publishing it, and a society has no statutory need for a member's
        // Aadhaar to raise a bill. Holding it turns any breach into a
        // reportable Aadhaar breach for no operational gain.
        //
        // The column is still read so that an older template does not fail to
        // parse — but the value is dropped here and never written. The row is
        // flagged as a notice, not an error: the import should succeed, and
        // the person running it should be told why one of their columns was
        // ignored.
        //
        // NOTE: this is about the member master only. Tenant police
        // verification (models/TenantRequest.js) is a separate flow with a
        // separate legal basis and is deliberately untouched.
        if (aadhaar) {
          cellIssues["aadhaar"] = {
            type: "IGNORED",
            message: "Aadhaar is no longer collected and will not be imported. Leave this column blank.",
          };
        }

        // 3. alternateContact validation
        if (alternateContact) {
          const altPhoneDigits = alternateContact.replace(/\D/g, "");
          if (altPhoneDigits.length !== 10) {
            cellIssues["alternateContact"] = {
              type: "ERROR",
              message: "Alternate contact must be 10 digits",
            };
            validCount.errors++;
          }
        }
        // 4. whatsappNumber validation
        if (whatsappNumber) {
          const whatsappDigits = whatsappNumber.replace(/\D/g, "");
          if (whatsappDigits.length !== 10) {
            cellIssues["whatsappNumber"] = {
              type: "ERROR",
              message: "WhatsApp number must be 10 digits",
            };
            validCount.errors++;
          }
        }
        // 5. emailSecondary validation
        if (
          emailSecondary &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSecondary)
        ) {
          cellIssues["emailSecondary"] = {
            type: "ERROR",
            message: "Invalid secondary email format",
          };
          validCount.errors++;
        }
        // 6. builtUpAreaSqft validation
        if (
          builtUpAreaSqft &&
          (builtUpAreaSqft <= 0 || builtUpAreaSqft > 15000)
        ) {
          cellIssues["builtUpAreaSqft"] = {
            type: "WARNING",
            message: "Built-up area seems unusual",
          };
          validCount.warnings++;
        }
        // 7. possessionDate validation
        if (possessionDate) {
          const possDate = new Date(possessionDate);
          const today = new Date();
          const minDate = new Date("2000-01-01");
          if (possDate > today) {
            cellIssues["possessionDate"] = {
              type: "WARNING",
              message: "Possession date is in the future",
            };
            validCount.warnings++;
          } else if (possDate < minDate) {
            cellIssues["possessionDate"] = {
              type: "WARNING",
              message: "Possession date seems too old (before 2000)",
            };
            validCount.warnings++;
          }
        }
        if (Object.keys(cellIssues).length > 0) {
          issues.push({
            sheet: detailsSheet.name,
            row: rowNumber,
            flatNo,
            cellIssues,
          });
        }
      });
    }
    // ========== VALIDATE SHEET 3: PARKING SLOTS ==========
    const parkingSheet = workbook.getWorksheet("3. Parking Slots");
    if (parkingSheet) {
      const fileFlatParkingCount = {};
      parkingSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flatNo = String(row.getCell(1).value || "").trim();
        const slotNumber = String(row.getCell(2).value || "").trim();
        const type = String(row.getCell(3).value || "").trim();
        const vehicleType = String(row.getCell(4).value || "").trim();
        if (!flatNo) return;
        const cellIssues = {};
        // 1. slotNumber validation
        if (!slotNumber) {
          cellIssues["slotNumber"] = {
            type: "ERROR",
            message: "Slot number is required",
          };
          validCount.errors++;
        } else if (existingParkingSlots.has(slotNumber)) {
          cellIssues["slotNumber"] = {
            type: "DUPLICATE_DB",
            message: `Parking slot ${slotNumber} already exists in database`,
          };
          validCount.duplicates++;
        } else if (fileParkingSlots.has(slotNumber)) {
          cellIssues["slotNumber"] = {
            type: "DUPLICATE_FILE",
            message: `Parking slot ${slotNumber} assigned to multiple flats`,
          };
          validCount.duplicates++;
        } else {
          fileParkingSlots.add(slotNumber);
        }
        // 2. type validation
        const validParkingTypes = ["Open", "Covered", "Stilt"];
        if (!type) {
          cellIssues["type"] = {
            type: "WARNING",
            message: "Parking type not specified",
          };
          validCount.warnings++;
        } else if (!validParkingTypes.includes(type)) {
          cellIssues["type"] = {
            type: "ERROR",
            message: `Invalid parking type. Must be: ${validParkingTypes.join(", ")}`,
          };
          validCount.errors++;
        }
        // 3. vehicleType validation
        const validVehicleTypes = ["Two-Wheeler", "Four-Wheeler"];
        if (!vehicleType) {
          cellIssues["vehicleType"] = {
            type: "WARNING",
            message: "Vehicle type not specified",
          };
          validCount.warnings++;
        } else if (!validVehicleTypes.includes(vehicleType)) {
          cellIssues["vehicleType"] = {
            type: "ERROR",
            message: `Invalid vehicle type. Must be: ${validVehicleTypes.join(", ")}`,
          };
          validCount.errors++;
        }
        // 4. Check excessive parking — warn if more than 6 slots per flat (unusual but valid)
        fileFlatParkingCount[flatNo] = (fileFlatParkingCount[flatNo] || 0) + 1;
        if (fileFlatParkingCount[flatNo] > 6) {
          cellIssues["flatNo"] = {
            type: "WARNING",
            message: `Flat ${flatNo} has more than 6 parking slots (unusual)`,
          };
          validCount.warnings++;
        }
        if (Object.keys(cellIssues).length > 0) {
          issues.push({
            sheet: parkingSheet.name,
            row: rowNumber,
            flatNo,
            cellIssues,
          });
        }
      });
    }
    // ========== VALIDATE SHEET 4: FAMILY MEMBERS ==========
    const familySheet = workbook.getWorksheet("4. Family Members");
    if (familySheet) {
      const fileFlatFamilyCount = {};
      familySheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flatNo = String(row.getCell(1).value || "").trim();
        const name = String(row.getCell(2).value || "").trim();
        const relation = String(row.getCell(3).value || "").trim();
        const age = row.getCell(4).value;
        const contactNumber = String(row.getCell(5).value || "").trim();
        const occupation = String(row.getCell(6).value || "").trim();
        if (!flatNo) return;
        const cellIssues = {};
        // 1. name validation WITH DUPLICATE CHECK
        if (!name) {
          cellIssues["name"] = {
            type: "ERROR",
            message: "Family member name is required",
          };
          validCount.errors++;
        } else if (name.length < 2) {
          cellIssues["name"] = {
            type: "ERROR",
            message: "Name must be at least 2 characters",
          };
          validCount.errors++;
        } else {
          const wing = flatWingMap[flatNo] || "";
          const familyKey = `${wing}-${flatNo}|||${name.toLowerCase()}`;
          if (existingFamilyMembers.has(familyKey)) {
            cellIssues["name"] = {
              type: "DUPLICATE_DB",
              message: `Family member ${name} already exists for flat ${flatNo}`,
            };
            validCount.duplicates++;
          } else if (fileFamilyMembers.has(familyKey)) {
            cellIssues["name"] = {
              type: "DUPLICATE_FILE",
              message: `Duplicate family member in file`,
            };
            validCount.duplicates++;
          } else {
            fileFamilyMembers.add(familyKey);
          }
        }
        // 2. relation validation
        const validRelations = [
          "Spouse",
          "Wife",
          "Father",
          "Mother",
          "Son",
          "Daughter",
          "Brother",
          "Sister",
          "Grandfather",
          "Grandmother",
        ];
        if (!relation) {
          cellIssues["relation"] = {
            type: "WARNING",
            message: "Relation not specified",
          };
          validCount.warnings++;
        } else if (!validRelations.includes(relation)) {
          cellIssues["relation"] = {
            type: "WARNING",
            message: `Unusual relation. Expected: ${validRelations.join(", ")}`,
          };
          validCount.warnings++;
        }
        // 3. age validation
        if (age && (age < 0 || age > 120)) {
          cellIssues["age"] = {
            type: "ERROR",
            message: "Age must be between 0 and 120",
          };
          validCount.errors++;
        }
        // 4. contactNumber validation
        if (contactNumber) {
          const phoneDigits = contactNumber.replace(/\D/g, "");
          if (phoneDigits.length !== 10) {
            cellIssues["contactNumber"] = {
              type: "ERROR",
              message: "Contact must be 10 digits",
            };
            validCount.errors++;
          }
        }
        // 5. Check excessive family members (max 10 per flat)
        fileFlatFamilyCount[flatNo] = (fileFlatFamilyCount[flatNo] || 0) + 1;
        if (fileFlatFamilyCount[flatNo] > 10) {
          cellIssues["flatNo"] = {
            type: "WARNING",
            message: `Flat ${flatNo} has more than 10 family members (unusual)`,
          };
          validCount.warnings++;
        }
        if (Object.keys(cellIssues).length > 0) {
          issues.push({
            sheet: familySheet.name,
            row: rowNumber,
            flatNo,
            cellIssues,
          });
        }
      });
    }
    // ========== VALIDATE SHEET 5: OWNER HISTORY ==========
    const ownerHistorySheet = workbook.getWorksheet("5. Owner History");
    if (ownerHistorySheet) {
      ownerHistorySheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flatNo = String(row.getCell(1).value || "").trim();
        const ownerSequence = row.getCell(2).value;
        const ownerName = String(row.getCell(3).value || "").trim();
        const contactNumber = String(row.getCell(4).value || "").trim();
        const email = String(row.getCell(5).value || "").trim();
        const panCard = String(row.getCell(6).value || "").trim();
        const purchaseDate = row.getCell(7).value;
        const saleDate = row.getCell(8).value;
        const purchasePrice = row.getCell(9).value;
        const salePrice = row.getCell(10).value;
        if (!flatNo || flatNo === "INSTRUCTIONS:") return;
        const cellIssues = {};
        // 1. ownerSequence validation
        if (!ownerSequence || ownerSequence <= 0) {
          cellIssues["ownerSequence"] = {
            type: "ERROR",
            message: "Owner sequence must be a positive number",
          };
          validCount.errors++;
        }
        // 2. ownerName validation WITH DUPLICATE CHECK
        if (!ownerName) {
          cellIssues["ownerName"] = {
            type: "ERROR",
            message: "Owner name is required",
          };
          validCount.errors++;
        } else if (ownerName.length < 2) {
          cellIssues["ownerName"] = {
            type: "ERROR",
            message: "Owner name must be at least 2 characters",
          };
          validCount.errors++;
        } else {
          const wing = flatWingMap[flatNo] || "";
          const ownerKey = `${wing}-${flatNo}|||${ownerName.toLowerCase()}`;
          if (existingOwnerHistory.has(ownerKey)) {
            cellIssues["ownerName"] = {
              type: "DUPLICATE_DB",
              message: `Owner ${ownerName} already exists for flat ${flatNo}`,
            };
            validCount.duplicates++;
          } else if (fileOwnerHistory.has(ownerKey)) {
            cellIssues["ownerName"] = {
              type: "DUPLICATE_FILE",
              message: `Duplicate owner in file`,
            };
            validCount.duplicates++;
          } else {
            fileOwnerHistory.add(ownerKey);
          }
        }
        // 3. contactNumber validation
        if (contactNumber) {
          const phoneDigits = contactNumber.replace(/\D/g, "");
          if (phoneDigits.length !== 10) {
            cellIssues["contactNumber"] = {
              type: "ERROR",
              message: "Contact must be 10 digits",
            };
            validCount.errors++;
          }
        }
        // 4. email validation
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          cellIssues["email"] = {
            type: "ERROR",
            message: "Invalid email format",
          };
          validCount.errors++;
        }
        // 5. panCard validation WITH DUPLICATE CHECK
        // if (panCard) {
        //   if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panCard)) {
        //     cellIssues['panCard'] = { type: 'ERROR', message: 'Invalid PAN format' };
        //     validCount.errors++;
        //   } else {
        //     const wing = flatWingMap[flatNo] || '';
        //     const panKey = `${wing}-${flatNo}|||PAN|||${panCard}`;
        //     if (existingOwnerHistory.has(panKey)) {
        //       cellIssues['panCard'] = { type: 'DUPLICATE_DB', message: `Owner PAN already exists for flat ${flatNo}` };
        //       validCount.duplicates++;
        //     }
        //   }
        // }
        // 6. Date validation
        if (purchaseDate && saleDate) {
          const pDate = new Date(purchaseDate);
          const sDate = new Date(saleDate);
          if (sDate < pDate) {
            cellIssues["saleDate"] = {
              type: "ERROR",
              message: "Sale date cannot be before purchase date",
            };
            validCount.errors++;
          }
        }
        // 7. Price validation
        if (
          purchasePrice &&
          (purchasePrice < 0 || purchasePrice > 1000000000)
        ) {
          cellIssues["purchasePrice"] = {
            type: "WARNING",
            message: "Purchase price seems unusual",
          };
          validCount.warnings++;
        }
        if (salePrice && (salePrice < 0 || salePrice > 1000000000)) {
          cellIssues["salePrice"] = {
            type: "WARNING",
            message: "Sale price seems unusual",
          };
          validCount.warnings++;
        }
        if (Object.keys(cellIssues).length > 0) {
          issues.push({
            sheet: ownerHistorySheet.name,
            row: rowNumber,
            flatNo,
            cellIssues,
          });
        }
      });
    }
    // ========== VALIDATE SHEET 6: TENANT HISTORY ==========
    const tenantHistorySheet = workbook.getWorksheet("6. Tenant History");
    if (tenantHistorySheet) {
      const currentTenants = {};
      tenantHistorySheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flatNo = String(row.getCell(1).value || "").trim();
        const tenantSequence = row.getCell(2).value;
        const tenantName = String(row.getCell(3).value || "").trim();
        const contactNumber = String(row.getCell(4).value || "").trim();
        const email = String(row.getCell(5).value || "").trim();
        const panCard = String(row.getCell(6).value || "").trim();
        const startDate = row.getCell(7).value;
        const endDate = row.getCell(8).value;
        const depositAmount = row.getCell(9).value;
        const rentPerMonth = row.getCell(10).value;
        const isCurrent = String(row.getCell(11).value || "").toLowerCase();
        if (!flatNo || flatNo === "INSTRUCTIONS:") return;
        const cellIssues = {};
        // 1. tenantSequence validation
        if (!tenantSequence || tenantSequence <= 0) {
          cellIssues["tenantSequence"] = {
            type: "ERROR",
            message: "Tenant sequence must be a positive number",
          };
          validCount.errors++;
        }
        // 2. tenantName validation WITH DUPLICATE CHECK
        if (!tenantName) {
          cellIssues["tenantName"] = {
            type: "ERROR",
            message: "Tenant name is required",
          };
          validCount.errors++;
        } else if (tenantName.length < 2) {
          cellIssues["tenantName"] = {
            type: "ERROR",
            message: "Tenant name must be at least 2 characters",
          };
          validCount.errors++;
        } else {
          const wing = flatWingMap[flatNo] || "";
          const tenantKey = `${wing}-${flatNo}|||${tenantName.toLowerCase()}`;
          if (existingTenantHistory.has(tenantKey)) {
            cellIssues["tenantName"] = {
              type: "DUPLICATE_DB",
              message: `Tenant ${tenantName} already exists for flat ${flatNo}`,
            };
            validCount.duplicates++;
          } else if (fileTenantHistory.has(tenantKey)) {
            cellIssues["tenantName"] = {
              type: "DUPLICATE_FILE",
              message: `Duplicate tenant in file`,
            };
            validCount.duplicates++;
          } else {
            fileTenantHistory.add(tenantKey);
          }
        }
        // 3. contactNumber validation
        if (contactNumber) {
          const phoneDigits = contactNumber.replace(/\D/g, "");
          if (phoneDigits.length !== 10) {
            cellIssues["contactNumber"] = {
              type: "ERROR",
              message: "Contact must be 10 digits",
            };
            validCount.errors++;
          }
        }
        // 4. email validation
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          cellIssues["email"] = {
            type: "ERROR",
            message: "Invalid email format",
          };
          validCount.errors++;
        }
        // 5. panCard validation WITH DUPLICATE CHECK
        // if (panCard) {
        //   if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panCard)) {
        //     cellIssues['panCard'] = { type: 'ERROR', message: 'Invalid PAN format' };
        //     validCount.errors++;
        //   } else {
        //     const wing = flatWingMap[flatNo] || '';
        //     const panKey = `${wing}-${flatNo}|||PAN|||${panCard}`;
        //     if (existingTenantHistory.has(panKey)) {
        //       cellIssues['panCard'] = { type: 'DUPLICATE_DB', message: `Tenant PAN already exists for flat ${flatNo}` };
        //       validCount.duplicates++;
        //     }
        //   }
        // }
        // 6. Date validation
        if (startDate && endDate) {
          const sDate = new Date(startDate);
          const eDate = new Date(endDate);
          if (eDate < sDate) {
            cellIssues["endDate"] = {
              type: "ERROR",
              message: "End date cannot be before start date",
            };
            validCount.errors++;
          }
        }
        // 7. Deposit/Rent validation
        if (depositAmount && (depositAmount < 0 || depositAmount > 10000000)) {
          cellIssues["depositAmount"] = {
            type: "WARNING",
            message: "Deposit amount seems unusual",
          };
          validCount.warnings++;
        }
        if (rentPerMonth && (rentPerMonth < 0 || rentPerMonth > 1000000)) {
          cellIssues["rentPerMonth"] = {
            type: "WARNING",
            message: "Rent per month seems unusual",
          };
          validCount.warnings++;
        }
        // 8. isCurrent validation - only one current tenant per flat
        if (isCurrent === "yes") {
          if (currentTenants[flatNo]) {
            cellIssues["isCurrent"] = {
              type: "ERROR",
              message: `Flat ${flatNo} already has a current tenant (row ${currentTenants[flatNo]})`,
            };
            validCount.errors++;
          } else {
            currentTenants[flatNo] = rowNumber;
          }
        }
        if (Object.keys(cellIssues).length > 0) {
          issues.push({
            sheet: tenantHistorySheet.name,
            row: rowNumber,
            flatNo,
            cellIssues,
          });
        }
      });
    }
  }
  return {
    issues,
    validCount,
    summary: {
      total: validCount.valid + validCount.errors + validCount.duplicates,
      valid: validCount.valid,
      errors: validCount.errors,
      warnings: validCount.warnings,
      duplicates: validCount.duplicates,
      canImport:
        validCount.errors === 0 &&
        validCount.duplicates === 0 &&
        validCount.warnings === 0,
    },
  };
}
// ========== ENHANCED IMPORT ==========
async function handleEnhancedImport(workbook, decoded) {
  try {
    const basicSheet = workbook.getWorksheet("1. Basic Info (Required)");
    const detailsSheet = workbook.getWorksheet("2. Additional Details");
    const parkingSheet = workbook.getWorksheet("3. Parking Slots");
    const familySheet = workbook.getWorksheet("4. Family Members");
    const ownerHistorySheet = workbook.getWorksheet("5. Owner History");
    const tenantHistorySheet = workbook.getWorksheet("6. Tenant History");
    if (!basicSheet) {
      return NextResponse.json(
        {
          error: "Basic Info sheet not found",
        },
        { status: 400 },
      );
    }
    // Parse all sheets
    const basicData = parseSheet(basicSheet);
    const additionalData = parseSheet(detailsSheet, [
      "panCard",
      "aadhaar",
      "alternateContact",
      "whatsappNumber",
      "emailSecondary",
      "builtUpAreaSqft",
      "possessionDate",
    ]);
    const parkingData = parseMultiRowSheet(parkingSheet, (row) => {
      const type = String(row.getCell(3).value || "").trim();
      return {
        slotNumber: row.getCell(2).value,
        type: type,
        vehicleType: row.getCell(4).value,
        monthlyBilling: type !== "Stilt", // auto-derived: Stilt = false, Open/Covered = true
      };
    });
    const familyData = parseMultiRowSheet(familySheet, (row) => ({
      name: row.getCell(2).value,
      relation: row.getCell(3).value,
      age: row.getCell(4).value,
      contactNumber: row.getCell(5).value,
      occupation: row.getCell(6).value,
    }));
    const ownerHistoryData = parseMultiRowSheet(ownerHistorySheet, (row) => ({
      ownerName: row.getCell(3).value,
      contactNumber: row.getCell(4).value,
      emailPrimary: row.getCell(5).value,
      panCard: row.getCell(6).value,
      ownershipStartDate: row.getCell(7).value,
      ownershipEndDate: row.getCell(8).value,
      purchaseAmount: row.getCell(9).value,
      saleAmount: row.getCell(10).value,
      durationMonths: row.getCell(11).value,
      isCurrent: false,
      transferType: "Purchase",
    }));
    const tenantHistoryData = parseMultiRowSheet(tenantHistorySheet, (row) => {
      const isCurrent =
        String(row.getCell(11).value || "").toLowerCase() === "yes";
      return {
        name: row.getCell(3).value,
        contactNumber: row.getCell(4).value,
        email: row.getCell(5).value,
        panCard: row.getCell(6).value,
        startDate: row.getCell(7).value
          ? new Date(row.getCell(7).value)
          : new Date(),
        endDate: row.getCell(8).value ? new Date(row.getCell(8).value) : null,
        depositAmount: Number(row.getCell(9).value) || 0,
        rentPerMonth: Number(row.getCell(10).value) || 0,
        isCurrent: isCurrent,
        duration: null,
      };
    });
    // ✅ GET NEXT MEMBERSHIP NUMBER
    const existingCount = await Member.countDocuments({
      societyId: decoded.societyId,
    });
    let nextNumber = existingCount + 1;
    // Check for duplicates
    const flatNos = Object.keys(basicData);
    const existingMembers = await Member.find({
      societyId: decoded.societyId,
      flatNo: { $in: flatNos },
    }).select("flatNo wing");
    const existingFlats = new Set(
      existingMembers.map((m) => `${m.wing || ""}-${m.flatNo}`),
    );
    const warnings = [];
    const createdMembers = [];
    const userCredentials = [];
    let parkingSlotsCount = 0;
    let ownerHistoryCount = 0;
    let tenantHistoryCount = 0;
    let familyMembersCount = 0;
    // Fetched once, not per-member (see the equivalent hoist further up in
    // this file for the other import path) - avoids re-querying every
    // username in the DB on each iteration of a potentially large import.
    const societyForDetailedImport = await Society.findById(decoded.societyId).select("name societyCode");
    const societyCodeForDetailedImport = await ensureSocietyCode(societyForDetailedImport);
    const usernameBloomDetailed = await buildUsernameBloomFilter();
    // ✅ CREATE MEMBERS ONE BY ONE WITH SEQUENTIAL MEMBERSHIP NUMBERS
    for (const [flatNo, basic] of Object.entries(basicData)) {
      const flatKey = `${basic.wing || ""}-${flatNo}`;
      if (existingFlats.has(flatKey)) {
        warnings.push({
          flatNo,
          message: `Flat ${flatKey} already exists - skipped`,
        });
        continue;
      }
      if (
        !basic.ownerName ||
        !basic.contactNumber ||
        !basic.emailPrimary ||
        !basic.carpetAreaSqft
      ) {
        throw new Error(`Flat ${flatNo}: Missing required fields`);
      }
      const additional = additionalData[flatNo] || {};
      const memberData = {
        flatNo: flatNo,
        wing: basic.wing || "",
        floor: basic.floor,
        ownerName: basic.ownerName,
        contactNumber: String(basic.contactNumber),
        emailPrimary: basic.emailPrimary,
        carpetAreaSqft: Number(basic.carpetAreaSqft),
        flatType: basic.flatType || "2BHK",
        ownershipType: basic.ownershipType || "Owner-Occupied",
        openingPrincipal: Number(basic["openingPrincipal"] ?? 0),
        openingInterest: Number(basic["openingInterest"] ?? 0),
        openingBalance:
          Number(basic["openingPrincipal"] ?? 0) +
          Number(basic["openingInterest"] ?? 0),
        societyId: decoded.societyId,
        membershipNumber: `MEM-${String(nextNumber).padStart(4, "0")}`, // ✅ MANUAL
        panCard: additional.panCard,
        // aadhaar deliberately not carried across — see the D1 note above.
        alternateContact: additional.alternateContact,
        whatsappNumber: additional.whatsappNumber,
        emailSecondary: additional.emailSecondary,
        builtUpAreaSqft: additional.builtUpAreaSqft,
        possessionDate: additional.possessionDate,
        parkingSlots: parkingData[flatNo] || [],
        familyMembers: familyData[flatNo] || [],
        ownerHistory: ownerHistoryData[flatNo] || [],
        tenantHistory: tenantHistoryData[flatNo] || [],
        membershipStatus: "Active",
        hasVotingRights: true,
        createdBy: decoded.userId,
      };
      parkingSlotsCount += (parkingData[flatNo] || []).length;
      familyMembersCount += (familyData[flatNo] || []).length;
      ownerHistoryCount += (ownerHistoryData[flatNo] || []).length;
      tenantHistoryCount += (tenantHistoryData[flatNo] || []).length;
      const member = await Member.create(memberData); // ✅ ONE AT A TIME
      nextNumber++; // ✅ INCREMENT
      // 2. Check existing user by email OR contact
      const existingUser = await User.findOne({
        $or: [
          { email: basic.emailPrimary?.toLowerCase() },
          { phone: String(basic.contactNumber) },
        ],
      });
      const newProfile = {
        profileId: new mongoose.Types.ObjectId(),
        societyId: decoded.societyId,
        memberId: member._id,
        role: "Member",
        flatNo: basic.flatNo,
        wing: basic.wing,
        societyName: societyForDetailedImport.name,
        isPrimary: false,
        status: "Active",
        joinedAt: new Date(),
      };
      let targetUser;
      let credentialPassword;
      let isNewUser = false;
      if (existingUser) {
        const alreadyLinked = existingUser.profiles?.some(
          (p) => String(p.memberId) === String(member._id),
        );
        if (!alreadyLinked) {
          await User.updateOne(
            { _id: existingUser._id },
            { $push: { profiles: newProfile } },
          );
        }
        targetUser = existingUser;
        credentialPassword = "(existing account — password unchanged)";
      } else {
        // New user — generate password only when needed
        const password = generatePassword();
        const hashedPassword = await bcrypt.hash(password, 10);
        const username = await generateSimpleUsername(
          societyCodeForDetailedImport,
          basic.flatNo,
          usernameBloomDetailed,
        );
        newProfile.isPrimary = true;
        targetUser = await User.create({
          name: basic.ownerName,
          username,
          email: basic.emailPrimary?.toLowerCase(),
          phone: String(basic.contactNumber),
          password: hashedPassword,
          role: "Member",
          profiles: [newProfile],
          activeProfileId: newProfile.profileId,
          isActive: true,
          mustChangePassword: true,
        });
        credentialPassword = password;
        isNewUser = true;
      }
      // 3. Backlink member → user
      await Member.updateOne({ _id: member._id }, { userId: targetUser._id });
      createdMembers.push({
        id: member._id,
        flatNo: member.flatNo,
        wing: member.wing,
        ownerName: member.ownerName,
      });
      userCredentials.push({
        flatNo: member.flatNo,
        wing: member.wing,
        ownerName: member.ownerName,
        username: isNewUser ? targetUser.username?.toUpperCase() : "(existing account)",
        email: basic.emailPrimary,
        password: credentialPassword,
        isNewUser,
      });
    }
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "IMPORT_MEMBERS",
      newData: {
        importedCount: createdMembers.length,
        importType: "enhanced",
      },
      timestamp: new Date(),
    });
    return NextResponse.json({
      success: true,
      summary: {
        total: flatNos.length,
        successful: createdMembers.length,
        skipped: warnings.length,
      },
      details: {
        parkingSlotsImported: parkingSlotsCount,
        familyMembersImported: familyMembersCount,
        ownerHistoryImported: ownerHistoryCount,
        tenantHistoryImported: tenantHistoryCount,
        usersCreated: userCredentials.length,
      },
      createdMembers,
      userCredentials,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    throw error;
  }
}
// ========== SIMPLE IMPORT ==========
async function handleSimpleImport(workbook, decoded) {
  try {
    const worksheet = workbook.worksheets[0];
    if (worksheet.rowCount > 1001) {
      return NextResponse.json(
        {
          error: "File too large. Maximum 1000 members allowed per upload.",
        },
        { status: 400 },
      );
    }
    const headerRow = worksheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(
        String(cell.value ?? "")
          .trim()
          .toLowerCase(),
      );
    });
    const members = [];
    const rowErrors = [];
    // ADD THIS:
    console.log("🔍 SHEET NAME:", worksheet.name);
    console.log("🔍 HEADERS:", headers);
    console.log("🔍 TOTAL ROWS:", worksheet.rowCount);
    const row2 = worksheet.getRow(2);
    const row2vals = [];
    row2.eachCell({ includeEmpty: true }, (cell) => row2vals.push(cell.value));
    console.log("🔍 ROW 2 RAW:", row2vals);
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const getCell = (columnName) => {
        const colIndex = headers.indexOf(columnName);
        if (colIndex === -1) return "";
        const cell = row.getCell(colIndex + 1);
        return String(cell.value || "").trim();
      };
      const flatno = getCell("flatno");
      const wing = getCell("wing");
      const name = getCell("name");
      const email = getCell("email");
      const mobileno = getCell("mobileno");
      const areasqftRaw = getCell("areasqft");
      const openingPrincipalRaw = getCell("openingprincipal"); // lowercase — simple template uses lowercase headers
      const openingInterestRaw = getCell("openinginterest");
      const balanceLegacyRaw = getCell("balance"); // backward compat for old uploads
      const errors = [];
      if (!flatno) errors.push("flatno is required");
      if (!name) errors.push("name is required");
      if (!email) errors.push("email is required");
      if (!areasqftRaw) {
        errors.push("areasqft is required");
      } else {
        const areasqft = parseFloat(areasqftRaw);
        if (isNaN(areasqft) || areasqft <= 0) {
          errors.push(`areasqft must be a positive number`);
        }
      }
      if (!mobileno) errors.push("mobileno is required");
      // openingPrincipal validation
      const resolvedPrincipal = openingPrincipalRaw
        ? parseFloat(openingPrincipalRaw)
        : balanceLegacyRaw
          ? parseFloat(balanceLegacyRaw) // legacy fallback
          : 0;
      const resolvedInterest = openingInterestRaw
        ? parseFloat(openingInterestRaw)
        : 0;
      if (openingPrincipalRaw && isNaN(resolvedPrincipal)) {
        errors.push(
          `openingPrincipal must be a number, got: "${openingPrincipalRaw}"`,
        );
      } else if (!isNaN(resolvedPrincipal) && resolvedPrincipal < 0) {
        errors.push("openingPrincipal cannot be negative");
      }
      if (openingInterestRaw && isNaN(resolvedInterest)) {
        errors.push(
          `openingInterest must be a number, got: "${openingInterestRaw}"`,
        );
      } else if (!isNaN(resolvedInterest) && resolvedInterest < 0) {
        errors.push("openingInterest cannot be negative");
      }
      if (errors.length === 0) {
        members.push({
          flatNo: flatno.substring(0, 50),
          wing: wing.substring(0, 10),
          ownerName: name.substring(0, 100),
          emailPrimary: email.substring(0, 100),
          contactNumber: mobileno.substring(0, 20),
          carpetAreaSqft: parseFloat(areasqftRaw),
          openingPrincipal: isNaN(resolvedPrincipal) ? 0 : resolvedPrincipal,
          openingInterest: isNaN(resolvedInterest) ? 0 : resolvedInterest,
          openingBalance:
            (isNaN(resolvedPrincipal) ? 0 : resolvedPrincipal) +
            (isNaN(resolvedInterest) ? 0 : resolvedInterest),
          flatType: getCell("config") || "2BHK",
          ownershipType: "Owner-Occupied",
          membershipStatus: "Active",
          hasVotingRights: true,
        });
      } else {
        rowErrors.push({
          row: rowNumber,
          errors: errors,
        });
      }
    });
    if (rowErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Row validation failed",
          details: rowErrors,
        },
        { status: 400 },
      );
    }
    // Check for duplicates
    const existingMembers = await Member.find({
      societyId: decoded.societyId,
    }).select("flatNo wing");
    const existingFlats = new Set(
      existingMembers.map((m) => `${m.wing}-${m.flatNo}`),
    );
    const duplicatesInFile = new Set();
    const duplicatesInDb = [];
    members.forEach((member, index) => {
      const key = `${member.wing}-${member.flatNo}`;
      if (duplicatesInFile.has(key)) {
        duplicatesInDb.push({ row: index + 2, flatNo: member.flatNo });
      }
      if (existingFlats.has(key)) {
        duplicatesInDb.push({ row: index + 2, flatNo: member.flatNo });
      }
      duplicatesInFile.add(key);
    });
    if (duplicatesInDb.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Duplicate flats detected",
          duplicates: duplicatesInDb,
        },
        { status: 400 },
      );
    }
    // ✅ GET NEXT MEMBERSHIP NUMBER
    const existingCount = await Member.countDocuments({
      societyId: decoded.societyId,
    });
    let nextNumber = existingCount + 1;
    const createdMembers = [];
    const userCredentials = [];
    // Fetched once, not per-member: the society doesn't change across this
    // loop, and re-querying every username in the DB (buildUsernameBloomFilter)
    // for every single member would be wasteful on a large import.
    // `address` is read by the onboarding email built below.
    const societyForImport = await Society.findById(decoded.societyId).select("name societyCode address");
    const societyCodeForImport = await ensureSocietyCode(societyForImport);
    const usernameBloom = await buildUsernameBloomFilter();
    // ✅ CREATE ONE BY ONE
    for (let i = 0; i < members.length; i++) {
      const memberData = members[i];
      memberData.societyId = decoded.societyId;
      memberData.createdBy = decoded.userId;
      memberData.membershipNumber = `MEM-${String(nextNumber).padStart(4, "0")}`; // ✅ MANUAL
      const member = await Member.create(memberData); // ✅ ONE AT A TIME
      nextNumber++; // ✅ INCREMENT
      const password = generatePassword();
      const { user: memberUser, isNew } = await upsertMemberUser({
        memberDoc: member,
        basic,
        societyId: decoded.societyId,
        societyName: societyForImport?.name ?? "",
        societyCode: societyCodeForImport,
        bloom: usernameBloom,
        plainPassword: password,
      });
      createdMembers.push({
        id: member._id,
        flatNo: member.flatNo,
        wing: member.wing,
        ownerName: member.ownerName,
      });
      // SEC-19: the generated password used to be returned here and was the
      // only way it ever reached the member — the admin downloaded it as an
      // .xlsx column and forwarded it. The password is still generated and
      // hashed (the account must not be left without one), but it is discarded
      // immediately; the member gets a 7-day setup link and picks their own,
      // exactly as the society bulk-import path already does.
      let setCredentialsUrl = null;
      if (isNew && basic.emailPrimary) {
        const onboardingToken = signToken(
          { userId: String(memberUser._id), purpose: "onboarding" },
          { expiresIn: "7d" },
        );
        setCredentialsUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/onboarding/set-credentials?token=${onboardingToken}`;
        // Best-effort: a mail failure must not roll back a member who was
        // already created. The link is returned either way so the admin can
        // deliver it by hand.
        try {
          await sendEmail({
            to: basic.emailPrimary,
            subject: `Set up your account — ${societyForImport?.name ?? "your society"}`,
            html: onboardingEmailHtml({
              memberName: member.ownerName,
              societyName: societyForImport?.name ?? "",
              societyAddress: societyForImport?.address ?? "",
              unitKind: "Flat",
              unitLabel: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
              setCredentialsUrl,
            }),
          });
        } catch (err) {
          console.error(
            `[members/import] onboarding email failed for ${basic.emailPrimary}:`,
            err?.message,
          );
        }
      }
      userCredentials.push({
        flatNo: member.flatNo,
        wing: member.wing,
        ownerName: member.ownerName,
        username: memberUser.username,
        email: basic.emailPrimary,
        isNewUser: isNew,
        setCredentialsUrl,
      });
    }
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "IMPORT_MEMBERS",
      newData: {
        importedCount: createdMembers.length,
        importType: "simple",
      },
      timestamp: new Date(),
    });
    return NextResponse.json(
      {
        success: true,
        message: `Imported ${createdMembers.length} members successfully`,
        createdMembers,
        userCredentials,
      },
      { status: 201 },
    );
  } catch (error) {
    throw error;
  }
}
// ========== HELPER FUNCTIONS ==========
function parseSheet(sheet, fields = null) {
  if (!sheet) return {};
  const data = {};
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    headers.push(
      String(cell.value ?? "")
        .trim()
        .replace(/\*/g, ""),
    );
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const flatNo = String(row.getCell(1).value || "").trim();
      if (!flatNo || flatNo === "INSTRUCTIONS:") return;
      const rowData = {};
      if (fields) {
        fields.forEach((field, index) => {
          rowData[field] = row.getCell(index + 2).value;
        });
      } else {
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header.replace("*", "").trim()] = cell.value;
          }
        });
      }
      data[flatNo] = rowData;
    }
  });
  return data;
}
function parseMultiRowSheet(sheet, mapper) {
  if (!sheet) return {};
  const data = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const flatNo = String(row.getCell(1).value || "").trim();
      if (!flatNo) return;
      if (!data[flatNo]) data[flatNo] = [];
      const item = mapper(row);
      if (item && Object.values(item).some((v) => v)) {
        data[flatNo].push(item);
      }
    }
  });
  return data;
}
