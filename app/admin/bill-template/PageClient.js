"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/BillTemplate.module.css";
import { OVERLAY_FIELD_KEYS } from "@/lib/bill-pdf-fields";
import { RECEIPT_OVERLAY_FIELD_KEYS } from "@/lib/receipt-pdf-fields";
import notify from "@/lib/notify";
// 3 DEFAULT TEMPLATES
const DEFAULT_TEMPLATES = {
  modern: {
    name: "Modern",
    design: {
      headerBg: "linear-gradient(135deg, var(--accent) 0%, var(--fg-4) 100%)",
      headerColor: "var(--bg-surface)",
      societyNameSize: 28,
      addressSize: 14,
      billTitleSize: 22,
      billTitleAlign: "center",
      tableHeaderBg: "#4f46e5",
      tableHeaderColor: "var(--bg-surface)",
      tableRowBg1: "var(--bg-surface)",
      tableRowBg2: "var(--bg-sunken)",
      tableBorderColor: "var(--border)",
      totalBg: "var(--primary-tint)",
      totalColor: "var(--primary-hover)",
      totalSize: 20,
      footerSize: 10,
      footerText: [
        "Payment should be made on or before due date",
        "Interest will be charged on overdue payments as per society rules",
        "This is a computer-generated bill",
      ],
      showSignature: true,
      signatureLabel: "Authorized Signatory",
    },
  },
  classic: {
    name: "Classic",
    design: {
      headerBg: "var(--bg-sunken)",
      headerColor: "var(--fg-2)",
      societyNameSize: 24,
      addressSize: 12,
      billTitleSize: 20,
      billTitleAlign: "center",
      tableHeaderBg: "var(--fg-2)",
      tableHeaderColor: "var(--bg-surface)",
      tableRowBg1: "var(--bg-surface)",
      tableRowBg2: "var(--bg-surface)",
      tableBorderColor: "var(--fg-1)",
      totalBg: "var(--bg-muted)",
      totalColor: "var(--fg-2)",
      totalSize: 18,
      footerSize: 10,
      footerText: [
        "Please make payment by due date to avoid interest charges",
        "For any queries, contact society office",
        "Thank you for your cooperation",
      ],
      showSignature: true,
      signatureLabel: "Secretary",
    },
  },
  minimal: {
    name: "Minimal",
    design: {
      headerBg: "var(--bg-surface)",
      headerColor: "var(--fg-1)",
      societyNameSize: 22,
      addressSize: 11,
      billTitleSize: 18,
      billTitleAlign: "left",
      tableHeaderBg: "var(--fg-1)",
      tableHeaderColor: "var(--bg-surface)",
      tableRowBg1: "var(--bg-surface)",
      tableRowBg2: "var(--bg-surface)",
      tableBorderColor: "var(--fg-1)",
      totalBg: "var(--fg-1)",
      totalColor: "var(--bg-surface)",
      totalSize: 16,
      footerSize: 9,
      footerText: ["Pay by due date", "Contact office for queries"],
      showSignature: false,
      signatureLabel: "",
    },
  },
};
export default function BillTemplateDesigner() {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [activeTab, setActiveTab] = useState("select"); // select, design, upload
  const [scope, setScope] = useState("bill"); // bill | receipt (which template is being edited)
  const [selectedTemplate, setSelectedTemplate] = useState("modern");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATES.modern.design);
  // Upload states
  const [uploadedPDF, setUploadedPDF] = useState(null);
  const [pdfHasFormFields, setPdfHasFormFields] = useState(false);
  const [detectedFields, setDetectedFields] = useState([]);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imageFields, setImageFields] = useState([]);
  const [uploadedLogo, setUploadedLogo] = useState(null);
  const [uploadedSignature, setUploadedSignature] = useState(null);
  // Field-mapping / sample-preview modal — null when closed, "pdf" or
  // "image" for which uploaded template it's currently editing. Shared by
  // both bill and receipt scope (the field vocabulary + preview endpoint
  // switch based on `scope`, see fieldVocab/previewEndpoint below).
  const [editorMode, setEditorMode] = useState(null);
  const [pdfFields, setPdfFields] = useState([]);
  const [selectedField, setSelectedField] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  // Rendered sample PDF (blob URL) for the uploaded-PDF/uploaded-image flow —
  // filled with a real member's real bill/receipt via the preview-fill
  // route, same code path as actual generation. Null until generated.
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewError, setPdfPreviewError] = useState(null);
  // Fetch society
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  const { data: billingHeadsData } = useQuery({
    queryKey: ["billing-heads"],
    queryFn: () => apiClient.get("/api/billing-heads/list"),
  });
  const { data: sampleMembersData } = useQuery({
    queryKey: ["template-sample-member"],
    queryFn: () => apiClient.get("/api/members/list?limit=25"),
  });
  // Which real member the admin is previewing. Defaults to the first member.
  const [previewMemberId, setPreviewMemberId] = useState("");
  const memberOptions = sampleMembersData?.members || [];
  useEffect(() => {
    if (!previewMemberId && memberOptions.length) setPreviewMemberId(memberOptions[0]._id);
  }, [memberOptions, previewMemberId]);
  // The member's REAL latest bill — this is what the preview renders, so the
  // admin verifies actual processed values instead of hardcoded sample numbers.
  const { data: previewBillData, isFetching: previewLoading, error: previewError } = useQuery({
    queryKey: ["template-preview-bill", previewMemberId],
    queryFn: () => apiClient.get(`/api/bill-template/preview-bill?memberId=${previewMemberId}`),
    enabled: Boolean(previewMemberId),
  });
  const previewBill = previewBillData?.bill || null;
  // Any change to the design (or, for the uploaded-PDF flow, the PDF itself,
  // its field positions, or the switch between template types) invalidates a
  // previous confirmation — Save re-gates until a fresh preview is confirmed.
  useEffect(() => {
    setPreviewConfirmed(false);
    setPdfPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPdfPreviewError(null);
  }, [
    template,
    previewMemberId,
    uploadedLogo,
    uploadedSignature,
    activeTab,
    scope,
    uploadedPDF,
    pdfFields,
    uploadedImage,
    imageFields,
  ]);
  // Fetch saved template
  const { data: savedTemplateData } = useQuery({
    queryKey: ["bill-template-full"],
    queryFn: () => apiClient.get("/api/bill-template/get-full"),
  });
  // Use billingHeadsData.heads to render live charge rows in template preview
  // Save template mutation
  useEffect(() => {
    const saved =
      scope === "receipt"
        ? savedTemplateData?.receiptTemplate
        : savedTemplateData?.template;
    if (!saved) return;
    if (saved.type === "custom" && saved.design) {
      setActiveTab("design");
      setTemplate(saved.design);
      setUploadedPDF(null);
      setUploadedImage(null);
    } else if (saved.type === "uploaded-pdf" && saved.pdfUrl) {
      setActiveTab("upload");
      setUploadedPDF(saved.pdfUrl);
      setPdfHasFormFields(saved.hasFormFields || false);
      setDetectedFields(saved.detectedFields || []);
      setPdfFields(saved.pdfFields || []);
      setUploadedImage(null);
    } else if (saved.type === "uploaded-image" && saved.imageUrl) {
      setActiveTab("upload");
      setUploadedImage(saved.imageUrl);
      setImageFields(saved.imageFields || []);
      setUploadedPDF(null);
    } else {
      setActiveTab(scope === "receipt" ? "design" : "select");
    }
    setUploadedLogo(saved.logoUrl);
    setUploadedSignature(saved.signatureUrl);
  }, [savedTemplateData, scope]);
  // Save template mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!previewConfirmed)
        throw new Error(
          `Preview a real member ${scope === "receipt" ? "receipt" : "bill"} and confirm it before saving`,
        );
      let templateData = {};
      if (activeTab === "select" || activeTab === "design") {
        templateData = {
          type: "custom",
          design: template,
          logoUrl: uploadedLogo,
          signatureUrl: uploadedSignature,
        };
      } else if (activeTab === "upload") {
        if (uploadedPDF) {
          templateData = {
            type: "uploaded-pdf",
            pdfUrl: uploadedPDF,
            hasFormFields: pdfHasFormFields,
            detectedFields,
            pdfFields,
            logoUrl: uploadedLogo,
            signatureUrl: uploadedSignature,
          };
        } else if (uploadedImage) {
          templateData = {
            type: "uploaded-image",
            imageUrl: uploadedImage,
            imageFields,
            logoUrl: uploadedLogo,
            signatureUrl: uploadedSignature,
          };
        }
      }
      return apiClient.post("/api/bill-template/save-full", {
        ...templateData,
        scope,
      });
    },
    onSuccess: () => {
      notify.success("Template saved successfully!");
      queryClient.invalidateQueries(["bill-template-full"]);
    },
    onError: (error) => {
      notify.error("Failed to save: " + error.message);
    },
  });
  // Render a sample PDF from the uploaded template (PDF or image) + a real
  // member's real bill/receipt, via the same fill logic used for actual
  // generation. `editorMode` ("pdf" | "image") picks which uploaded template
  // to fill; `scope` ("bill" | "receipt") picks which preview endpoint (and
  // therefore which real record — Bill vs Receipt) to fill it with.
  const previewFillMutation = useMutation({
    mutationFn: async () => {
      const isImageMode = editorMode === "image";
      const templateUrl = isImageMode ? uploadedImage : uploadedPDF;
      if (!templateUrl) throw new Error(isImageMode ? "Upload an image first" : "Upload a PDF first");
      if (!previewMemberId) throw new Error("Pick a member to preview");
      const endpoint =
        scope === "receipt" ? "/api/receipt-template/preview-fill" : "/api/bill-template/preview-fill";
      const res = await apiClient.post(endpoint, {
        type: isImageMode ? "uploaded-image" : "uploaded-pdf",
        pdfUrl: isImageMode ? undefined : uploadedPDF,
        imageUrl: isImageMode ? uploadedImage : undefined,
        memberId: previewMemberId,
        pdfFields: isImageMode ? undefined : pdfFields,
        imageFields: isImageMode ? imageFields : undefined,
      });
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    onSuccess: (url) => {
      setPdfPreviewError(null);
      setPreviewConfirmed(false);
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    },
    onError: (error) => {
      setPdfPreviewError(error.message || "Failed to render preview");
    },
  });
  // SMART PDF UPLOAD - Auto-detect form fields
  const handlePDFUpload = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/bill-template/upload-pdf-smart", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      setUploadedPDF(data.url);
      setPdfHasFormFields(data.hasFormFields);
      setDetectedFields(data.detectedFields || []);
      if (data.hasFormFields) {
        notify.success(
          `PDF uploaded! Auto-detected ${data.detectedFields.length} fillable fields.\n\nSystem will auto-fill these when generating bills.`,
        );
      } else {
        notify.success(
          "PDF uploaded! No fillable fields detected.\n\nSystem will overlay data on PDF.",
        );
      }
    } catch (error) {
      notify.error("Upload failed: " + error.message);
    }
  };
  // Upload other files
  const handleFileUpload = async (file, type) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    try {
      const response = await fetch("/api/bill-template/upload-file", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      if (type === "image") {
        setUploadedImage(data.url);
      } else if (type === "logo") {
        setUploadedLogo(data.url);
      } else if (type === "signature") {
        setUploadedSignature(data.url);
      }
      notify.success(`${type} uploaded successfully!`);
    } catch (error) {
      notify.error("Upload failed: " + error.message);
    }
  };
  // Apply default template
  const applyDefaultTemplate = (key) => {
    setSelectedTemplate(key);
    setTemplate(DEFAULT_TEMPLATES[key].design);
    setActiveTab("design");
  };
  // Update template field
  const updateTemplate = (key, value) => {
    setTemplate({ ...template, [key]: value });
  };
  // Add/Remove footer text
  const addFooterLine = () => {
    setTemplate({
      ...template,
      footerText: [...template.footerText, "New instruction"],
    });
  };
  const updateFooterLine = (index, value) => {
    const newFooter = [...template.footerText];
    newFooter[index] = value;
    setTemplate({ ...template, footerText: newFooter });
  };
  const removeFooterLine = (index) => {
    setTemplate({
      ...template,
      footerText: template.footerText.filter((_, i) => i !== index),
    });
  };
  // Generate preview HTML (same as before, but with dynamic billing heads)
  const generatePreviewHTML = () => {
    const society = societyData?.society || {};
    const config = society.config || {};
    const heads = billingHeadsData?.heads || [];
    const sampleMember =
      (previewBill && previewBill.member) ||
      (memberOptions.find((m) => m._id === previewMemberId) ?? memberOptions[0]) ||
      {};
    const real = previewBill || null;
    // Build charges from billing heads
    const charges = [];
    charges.push({ name: "Maintenance", amount: 3600, rate: 3, perSqFt: true });
    charges.push({
      name: "Sinking Fund",
      amount: 1200,
      rate: 1,
      perSqFt: true,
    });
    charges.push({
      name: "Repair Fund",
      amount: 600,
      rate: 0.5,
      perSqFt: true,
    });
    // Add custom heads
    heads.forEach((head) => {
      if (head.calculationType === "Fixed") {
        charges.push({
          name: head.headName,
          amount: head.defaultAmount,
          fixed: true,
        });
      } else if (head.calculationType === "Per Sq Ft") {
        charges.push({
          name: head.headName,
          amount: 1200 * head.defaultAmount,
          rate: head.defaultAmount,
          perSqFt: true,
        });
      }
    });
    const sampleData = {
      societyName: societyData?.society?.name || "Sample Society",
      societyAddress: societyData?.society?.address || "Society Address, City",
      memberName: sampleMember.ownerName || "Sample member",
      flatNo: `${sampleMember.wing || ""}-${sampleMember.flatNo || "—"}`,
      area: sampleMember.carpetAreaSqft || sampleMember.builtUpAreaSqft || 0,
      billPeriod: real?.billPeriodId || "2026-04",
      billDate: real?.billDate ? new Date(real.billDate).toLocaleDateString("en-IN") : "15/4/2026",
      dueDate: real?.dueDate ? new Date(real.dueDate).toLocaleDateString("en-IN") : "9/5/2026",
      previousBalance: real?.previousBalance ?? 2426,
      daysOverdue: real?.daysOverdue ?? 0,
      interestRate: societyData?.society?.config?.interestRate || 21,
      interestMethod:
        societyData?.society?.config?.interestCalculationMethod || "SIMPLE",
      gracePeriodDays: societyData?.society?.config?.gracePeriodDays || 15,
      interestAmount: real?.interestAmount ?? 96.88,
      // this month's NEW interest only — previousBalance already includes
      // carried interest, so summing both would double-count it.
      currentInterestOnly: real?.currentInterest ?? real?.interestAmount ?? 96.88,
      charges: real?.charges?.length ? real.charges : charges,
      subtotal: charges.reduce((s, c) => s + c.amount, 0),
      serviceTax: +(
        charges.reduce((s, c) => s + c.amount, 0) *
        ((societyData?.society?.config?.serviceTaxRate || 0) / 100)
      ).toFixed(2),
      get currentBillTotal() {
        return +(this.subtotal + this.serviceTax).toFixed(2);
      },
      get grandTotal() {
        if (real?.totalAmount != null) return +Number(real.totalAmount).toFixed(2);
        return +(
          this.previousBalance +
          this.currentInterestOnly +
          this.currentBillTotal
        ).toFixed(2);
      },
    };
    // Full preview HTML
    return `
      <div style="max-width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white;">
        <!-- Header -->
        <div style="background: ${template.headerBg}; color: ${template.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          ${uploadedLogo ? `<img src="${uploadedLogo}" style="width: 80px; margin-bottom: 15px;" />` : ""}
          <h1 style="margin: 0; font-size: ${template.societyNameSize}px;">${sampleData.societyName}</h1>
          <p style="margin: 5px 0 0 0; font-size: ${template.addressSize}px; opacity: 0.9;">${sampleData.societyAddress}</p>
        </div>
        <!-- Bill Title -->
        <h2 style="text-align: ${template.billTitleAlign}; font-size: ${template.billTitleSize}px; margin: 0 0 20px 0;">
          MAINTENANCE BILL
        </h2>
        <!-- Bill Info -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: var(--bg-sunken); border-radius: 8px; border: 1px solid var(--border);">
          <div><strong>Bill Period:</strong> ${sampleData.billPeriod}</div>
          <div><strong>Bill Date:</strong> ${sampleData.billDate}</div>
          <div><strong>Member:</strong> ${sampleData.flatNo}</div>
          <div><strong>Due Date:</strong> ${sampleData.dueDate}</div>
          <div><strong>Name:</strong> ${sampleData.memberName}</div>
          <div><strong>Area:</strong> ${sampleData.area} sq ft</div>
        </div>
        <!-- Previous Balance Section -->
        ${
          sampleData.previousBalance > 0
            ? `
          <div style="background: var(--danger-bg); border-left: 4px solid var(--danger); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: var(--danger-fg); font-size: 16px;">Previous Outstanding</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <div style="font-size: 12px; color: var(--danger-fg); margin-bottom: 5px;">Previous Balance</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--danger);">₹${sampleData.previousBalance.toLocaleString("en-IN")}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: var(--danger-fg); margin-bottom: 5px;">Days Overdue</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--danger);">${sampleData.daysOverdue} days</div>
              </div>
            </div>
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #fca5a5;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 12px; color: var(--danger-fg); margin-bottom: 5px;">
                    Interest @ ${sampleData.interestRate}% p.a. (${sampleData.interestMethod})
                  </div>
                  <div style="font-size: 11px; color: var(--danger-fg);">
                    Grace: ${sampleData.gracePeriodDays} days | Overdue: ${sampleData.daysOverdue} days
                  </div>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: var(--danger);">
                  ₹${sampleData.interestAmount.toLocaleString("en-IN")}
                </div>
              </div>
            </div>
          </div>
        `
            : ""
        }
        <!-- Current Charges Table -->
        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: var(--fg-3);">Current Month Charges</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: ${template.tableHeaderBg}; color: ${template.tableHeaderColor};">
              <th style="padding: 12px; text-align: left; border: 1px solid ${template.tableBorderColor};">Sr.</th>
              <th style="padding: 12px; text-align: left; border: 1px solid ${template.tableBorderColor};">Particulars</th>
              <th style="padding: 12px; text-align: center; border: 1px solid ${template.tableBorderColor};">Rate</th>
              <th style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor};">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${sampleData.charges
              .map(
                (charge, idx) => `
              <tr style="background: ${idx % 2 === 0 ? template.tableRowBg1 : template.tableRowBg2};">
                <td style="padding: 10px; border: 1px solid ${template.tableBorderColor};">${idx + 1}</td>
                <td style="padding: 10px; border: 1px solid ${template.tableBorderColor};">
                  ${charge.name}
                  ${charge.perSqFt ? `<span style="font-size: 11px; color: var(--fg-4);"> (${sampleData.area} sq ft)</span>` : ""}
                </td>
                <td style="padding: 10px; text-align: center; border: 1px solid ${template.tableBorderColor}; font-size: 13px; color: var(--fg-4);">
                  ${charge.perSqFt ? `₹${charge.rate}/sq ft` : charge.fixed ? "Fixed" : "-"}
                </td>
                <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor}; font-weight: 600;">
                  ${charge.amount.toLocaleString("en-IN")}
                </td>
              </tr>
            `,
              )
              .join("")}
            <tr style="background: var(--bg-sunken); font-weight: 600;">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">Subtotal</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">
                ${sampleData.subtotal.toLocaleString("en-IN")}
              </td>
            </tr>
            <tr style="background: var(--bg-sunken);">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">Service Tax (2%)</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor}; font-weight: 600;">
                ${sampleData.serviceTax.toLocaleString("en-IN")}
              </td>
            </tr>
            <tr style="background: var(--primary-tint); font-weight: 700; font-size: 16px;">
              <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor}; color: var(--primary-hover);">
                CURRENT BILL TOTAL
              </td>
              <td style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor}; color: var(--primary-hover);">
                ₹${sampleData.currentBillTotal.toLocaleString("en-IN")}
              </td>
            </tr>
          </tbody>
        </table>
        <!-- Grand Total -->
        <div style="background: ${template.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 2px solid ${template.totalColor};">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 14px; color: ${template.totalColor}; margin-bottom: 5px;">TOTAL AMOUNT PAYABLE</div>
              <div style="font-size: 12px; color: var(--fg-4);">
                (Previous: ₹${(sampleData.previousBalance + sampleData.currentInterestOnly).toLocaleString("en-IN")} + Current: ₹${sampleData.currentBillTotal.toLocaleString("en-IN")})
              </div>
            </div>
            <div style="font-size: ${template.totalSize}px; font-weight: 700; color: ${template.totalColor};">
              ₹${sampleData.grandTotal.toLocaleString("en-IN")}
            </div>
          </div>
        </div>
        <!-- Footer Instructions -->
        ${
          template.footerText && template.footerText.length > 0
            ? `
          <div style="border-top: 2px solid var(--border); padding-top: 20px; margin-bottom: 30px;">
            <strong style="display: block; margin-bottom: 10px;">Terms & Conditions:</strong>
            <ol style="margin: 0; padding-left: 20px; font-size: ${template.footerSize}px; color: var(--fg-4);">
              ${template.footerText.map((text) => `<li style="margin-bottom: 5px;">${text}</li>`).join("")}
            </ol>
          </div>
        `
            : ""
        }
        <!-- Signature -->
        ${
          template.showSignature
            ? `
          <div style="text-align: right; margin-top: 40px;">
            ${
              uploadedSignature
                ? `
              <img src="${uploadedSignature}" style="width: 150px; margin-bottom: 10px;" />
            `
                : `
              <div style="height: 60px; border-bottom: 2px solid var(--fg-1); width: 200px; margin-left: auto; margin-bottom: 10px;"></div>
            `
            }
            <div style="font-size: 12px; color: var(--fg-4);">${template.signatureLabel || "Authorized Signatory"}</div>
          </div>
        `
            : ""
        }
      </div>
    `;
  };
  // Open the field-mapping / sample-preview modal for the uploaded PDF or
  // uploaded image. Which fields array (pdfFields vs imageFields) the modal
  // reads/writes is driven by editorMode below.
  const openPDFEditor = () => {
    if (!uploadedPDF) {
      notify.info("Please upload a PDF first");
      return;
    }
    setEditorMode("pdf");
  };
  const openImageEditor = () => {
    if (!uploadedImage) {
      notify.info("Please upload an image first");
      return;
    }
    setEditorMode("image");
  };
  // Add field to the currently-open template (PDF or image)
  const addFieldToPDF = (fieldName) => {
    const newField = {
      id: Date.now(),
      name: fieldName,
      x: 50,
      y: 50,
      width: 150,
      height: 30,
      fontSize: 12,
      fontColor: "var(--fg-1)",
    };
    if (editorMode === "image") {
      setImageFields((fields) => [...fields, newField]);
    } else {
      setPdfFields((fields) => [...fields, newField]);
    }
    setSelectedField(newField.id);
  };
  // Update field properties
  const updateFieldProperty = (fieldId, property, value) => {
    const updater = (fields) =>
      fields.map((field) =>
        field.id === fieldId ? { ...field, [property]: value } : field,
      );
    if (editorMode === "image") {
      setImageFields(updater);
    } else {
      setPdfFields(updater);
    }
  };
  // Delete field
  const deleteField = (fieldId) => {
    if (editorMode === "image") {
      setImageFields((fields) => fields.filter((field) => field.id !== fieldId));
    } else {
      setPdfFields((fields) => fields.filter((field) => field.id !== fieldId));
    }
    if (selectedField === fieldId) {
      setSelectedField(null);
    }
  };
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Bill Template Designer</h1>
          <p>Professional bill template with interest calculation</p>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !previewConfirmed}
          title={previewConfirmed ? "Save this template" : "Confirm the live preview below first — that is what enables Save"}
          className="btn btn-primary"
        >
          {saveMutation.isPending
            ? "Saving..."
            : `Save ${scope === "receipt" ? "Receipt" : "Bill"} Template`}
        </button>
      </div>
      {/* Bill vs Receipt scope */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          ["bill", "Bill Template"],
          ["receipt", "Receipt Template"],
        ].map(([s, label]) => (
          <button
            key={s}
            onClick={() => {
              setScope(s);
              if (s === "receipt") setActiveTab("design");
            }}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: scope === s ? "2px solid var(--primary)" : "1px solid var(--border-strong)",
              background: scope === s ? "var(--primary-tint)" : "var(--bg-surface)",
              fontWeight: scope === s ? 700 : 500,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {scope === "receipt" && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "var(--primary-tint)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--primary)",
          }}
        >
          Designing the <strong>receipt</strong> template (used for payment &
          advance receipts). Colours, logo, signature and footer apply to
          generated receipts. You can also upload a PDF/image receipt
          template in the Upload tab, mapped from a real recorded payment.
        </div>
      )}
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "select" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("select")}
        >
          Choose Template
        </button>
        <button
          className={`${styles.tab} ${activeTab === "design" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("design")}
        >
          Customize Design
        </button>
        <button
          className={`${styles.tab} ${activeTab === "upload" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          Upload Custom PDF/Image
        </button>
      </div>
      {/* Tab 1: Select Default Template */}
      {activeTab === "select" && (
        <div className={styles.templateGrid}>
          {Object.entries(DEFAULT_TEMPLATES).map(([key, value]) => (
            <div
              key={key}
              className={styles.templateCard}
              onClick={() => applyDefaultTemplate(key)}
            >
              <div className={styles.templatePreview}>
                <div
                  style={{
                    background: value.design.headerBg,
                    color: value.design.headerColor,
                    padding: "15px",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                >
                  {value.name} Template
                </div>
                <div style={{ padding: "15px", fontSize: "12px" }}>
                  <div
                    style={{
                      background: value.design.tableHeaderBg,
                      color: value.design.tableHeaderColor,
                      padding: "8px",
                      marginBottom: "5px",
                    }}
                  >
                    Table Header
                  </div>
                  <div
                    style={{
                      padding: "8px",
                      background: value.design.tableRowBg1,
                    }}
                  >
                    Row 1
                  </div>
                  <div
                    style={{
                      padding: "8px",
                      background: value.design.tableRowBg2,
                    }}
                  >
                    Row 2
                  </div>
                  <div
                    style={{
                      background: value.design.totalBg,
                      color: value.design.totalColor,
                      padding: "10px",
                      marginTop: "10px",
                      fontWeight: "bold",
                    }}
                  >
                    Total: ₹10,000
                  </div>
                </div>
              </div>
              <button className="btn btn-primary btn-sm">
                Use {value.name}
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Tab 2: Design Customization */}
      {activeTab === "design" && (
        <div className={styles.workspace}>
          {/* Controls - SAME AS BEFORE but more organized */}
          <div className={styles.controlPanel}>
            <h3>Header</h3>
            <div className={styles.control}>
              <label>Background</label>
              <input
                type="text"
                value={template.headerBg}
                onChange={(e) => updateTemplate("headerBg", e.target.value)}
                placeholder="var(--bg-surface) or gradient"
              />
            </div>
            <div className={styles.control}>
              <label>Text Color</label>
              <input
                type="color"
                value={
                  template.headerColor?.startsWith("#")
                    ? template.headerColor
                    : "#f5f7fb"
                }
                onChange={(e) => updateTemplate("headerColor", e.target.value)}
              />
            </div>
            <div className={styles.control}>
              <label>Society Name Size (px)</label>
              <input
                type="number"
                value={template.societyNameSize}
                onChange={(e) =>
                  updateTemplate("societyNameSize", +e.target.value)
                }
              />
            </div>
            <h3>Table</h3>
            <div className={styles.control}>
              <label>Header Background</label>
              <input
                type="color"
                value={
                  template.tableHeaderBg?.startsWith("#")
                    ? template.tableHeaderBg
                    : "#1f2a44"
                }
                onChange={(e) => updateTemplate("tableHeaderBg", e.target.value)}
              />
            </div>
            <div className={styles.control}>
              <label>Header Text Color</label>
              <input
                type="color"
                value={
                  template.tableHeaderColor?.startsWith("#")
                    ? template.tableHeaderColor
                    : "#f5f7fb"
                }
                onChange={(e) =>
                  updateTemplate("tableHeaderColor", e.target.value)
                }
              />
            </div>
            <div className={styles.control}>
              <label>Border Color</label>
              <input
                type="color"
                value={
                  template.tableBorderColor?.startsWith("#")
                    ? template.tableBorderColor
                    : "#374151"
                }
                onChange={(e) =>
                  updateTemplate("tableBorderColor", e.target.value)
                }
              />
            </div>
            <h3>Total Box</h3>
            <div className={styles.control}>
              <label>Background</label>
              <input
                type="color"
                value={
                  template.totalBg?.startsWith("#") ? template.totalBg : "#c7d2fe"
                }
                onChange={(e) => updateTemplate("totalBg", e.target.value)}
              />
            </div>
            <div className={styles.control}>
              <label>Text Color</label>
              <input
                type="color"
                value={
                  template.totalColor?.startsWith("#")
                    ? template.totalColor
                    : "#4f46e5"
                }
                onChange={(e) => updateTemplate("totalColor", e.target.value)}
              />
            </div>
            <div className={styles.control}>
              <label>Total Font Size (px)</label>
              <input
                type="number"
                value={template.totalSize}
                onChange={(e) => updateTemplate("totalSize", +e.target.value)}
              />
            </div>
            <h3>Footer</h3>
            {template.footerText?.map((line, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                <input
                  type="text"
                  value={line}
                  onChange={(e) => updateFooterLine(i, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => removeFooterLine(i)}
                  style={{ color: "var(--danger)" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addFooterLine}
              className="btn btn-secondary btn-sm"
            >
              + Add Line
            </button>
            <h3>Signature</h3>
            <label
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
              <input
                type="checkbox"
                checked={template.showSignature}
                onChange={(e) =>
                  updateTemplate("showSignature", e.target.checked)
                }
              />
              Show Signature Block
            </label>
            {template.showSignature && (
              <div className={styles.control}>
                <input
                  type="text"
                  value={template.signatureLabel}
                  onChange={(e) =>
                    updateTemplate("signatureLabel", e.target.value)
                  }
                  placeholder="Authorized Signatory"
                />
              </div>
            )}
            <h3>Logo / Signature Image</h3>
            <label>Upload Logo</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={(e) => handleFileUpload(e.target.files[0], "logo")}
            />
            <label>Upload Signature</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={(e) => handleFileUpload(e.target.files[0], "signature")}
            />
          </div>
          {/* Preview with FULL DATA */}
          <div className={styles.previewPanel}>
            <h2>Live Preview — real member bill</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Preview as member:</label>
              <select value={previewMemberId} onChange={(e) => setPreviewMemberId(e.target.value)}>
                {memberOptions.length === 0 ? <option value="">No members found</option> : null}
                {memberOptions.map((m) => (
                  <option key={m._id} value={m._id}>
                    {(m.wing ? m.wing + "-" : "") + (m.flatNo || "")} · {m.ownerName || ""}
                  </option>
                ))}
              </select>
              {previewLoading ? <span style={{ fontSize: 12 }}>Loading real bill…</span> : null}
            </div>
            {previewError ? (
              <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
                Could not load a real bill: {String(previewError.message || previewError)}. The preview below is showing sample figures.
              </div>
            ) : null}
            {!previewLoading && !previewError && !previewBill ? (
              <div style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
                This member has no generated bill yet, so sample figures are shown. Generate a bill to verify real mapping.
              </div>
            ) : null}
            {previewBill ? (
              <div style={{ background: "var(--success-bg)", color: "var(--success-fg)", padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
                Showing real bill <strong>{previewBill.billPeriodId}</strong> for{" "}
                <strong>{(previewBill.member?.wing ? previewBill.member.wing + "-" : "") + (previewBill.member?.flatNo || "")}</strong>{" "}
                — total <strong>₹{previewBill.totalAmount}</strong>, area{" "}
                <strong>{previewBill.member?.areaSqFt || previewBill.member?.carpetAreaSqft || "—"} sq ft</strong>.
              </div>
            ) : null}
            <div className={styles.previewWrapper}>
              <div dangerouslySetInnerHTML={{ __html: generatePreviewHTML() }} />
              <button type="button" className="btn btn-success"
                onClick={() => setPreviewConfirmed(true)} style={{ marginTop: "1rem" }}>
                {previewConfirmed
                  ? "Preview confirmed — you can now save"
                  : previewBill
                    ? "Confirm this real-member preview"
                    : "Confirm preview (no real bill available)"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Tab 3: Upload PDF - SMART VERSION */}
      {activeTab === "upload" && (
        <div className={styles.uploadSection}>
          <div className={styles.uploadCard}>
            <h3>Upload Your PDF {scope === "receipt" ? "Receipt" : "Bill"} Template</h3>
            <p style={{ marginBottom: "1.5rem", lineHeight: "1.6" }}>
              Upload your society's existing PDF {scope === "receipt" ? "receipt" : "bill"} format.
              <br />
              <strong>System will automatically:</strong>
            </p>
            <ul
              style={{
                textAlign: "left",
                marginBottom: "1.5rem",
                lineHeight: "1.8",
              }}
            >
              <li>Detect if PDF has fillable form fields</li>
              <li>Auto-fill member name, flat no, charges, totals</li>
              <li>Use your billing heads from configuration</li>
              <li>Calculate interest & previous balance</li>
              <li>No manual field mapping needed!</li>
            </ul>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handlePDFUpload(e.target.files[0])}
              style={{ marginBottom: "1rem" }}
            />
            {uploadedPDF && (
              <div className={styles.uploadedPreview}>
                <p
                  style={{
                    color: "var(--success)",
                    fontWeight: "600",
                    marginBottom: "1rem",
                  }}
                >
                  PDF Template Uploaded Successfully!
                </p>
                {pdfHasFormFields ? (
                  <div
                    style={{
                      background: "var(--success-bg)",
                      padding: "1.5rem",
                      borderRadius: "8px",
                      marginBottom: "1rem",
                    }}
                  >
                    <p
                      style={{
                        margin: "0 0 0.75rem 0",
                        fontWeight: "600",
                        color: "var(--success-fg)",
                      }}
                    >
                      Great! Your PDF has {detectedFields.length} fillable
                      fields:
                    </p>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(150px, 1fr))",
                        gap: "0.5rem",
                      }}
                    >
                      {detectedFields.map((field, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: "var(--bg-surface)",
                            padding: "0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.875rem",
                            fontWeight: "500",
                            color: "var(--fg-3)",
                          }}
                        >
                          {field}
                        </div>
                      ))}
                    </div>
                    <p
                      style={{
                        margin: "1rem 0 0 0",
                        fontSize: "0.875rem",
                        color: "var(--success-fg)",
                      }}
                    >
                      System will auto-fill these when generating bills
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "var(--warning-bg)",
                      padding: "1.5rem",
                      borderRadius: "8px",
                      marginBottom: "1rem",
                    }}
                  >
                    <p
                      style={{ margin: 0, fontWeight: "600", color: "var(--warning-fg)" }}
                    >
                      ℹ️ No fillable fields detected. System will overlay data
                      on PDF.
                    </p>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    margin: "1rem 0",
                  }}
                >
                  <button type="button" className="btn btn-primary" onClick={openPDFEditor}>
                    Configure fields & preview a real sample {scope === "receipt" ? "receipt" : "bill"}
                  </button>
                  {previewConfirmed ? (
                    <span style={{ color: "var(--success)", fontWeight: 600, fontSize: 13 }}>
                      Sample confirmed — Save is unlocked
                    </span>
                  ) : (
                    <span style={{ color: "var(--warning-fg)", fontWeight: 600, fontSize: 13 }}>
                      Save is locked until you preview &amp; confirm a real sample {scope === "receipt" ? "receipt" : "bill"}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "var(--fg-4)", margin: "0 0 0.5rem 0" }}>
                  Raw uploaded file (unfilled):
                </p>
                <iframe
                  src={uploadedPDF}
                  style={{
                    width: "100%",
                    height: "400px",
                    border: "2px solid var(--border)",
                    borderRadius: "8px",
                    marginTop: "0.25rem",
                  }}
                />
              </div>
            )}
          </div>
          <div className={styles.uploadCard}>
            <h3>Or Upload Image {scope === "receipt" ? "Receipt" : "Bill"} Template</h3>
            <p>
              Upload {scope === "receipt" ? "receipt" : "bill"} as JPG/PNG. System will overlay text
              fields you position on top of it.
            </p>
            <input
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={(e) => handleFileUpload(e.target.files[0], "image")}
            />
            {uploadedImage && (
              <div className={styles.uploadedPreview}>
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    margin: "1rem 0",
                  }}
                >
                  <button type="button" className="btn btn-primary" onClick={openImageEditor}>
                    Configure fields & preview a real sample {scope === "receipt" ? "receipt" : "bill"}
                  </button>
                  {previewConfirmed ? (
                    <span style={{ color: "var(--success)", fontWeight: 600, fontSize: 13 }}>
                      Sample confirmed — Save is unlocked
                    </span>
                  ) : (
                    <span style={{ color: "var(--warning-fg)", fontWeight: 600, fontSize: 13 }}>
                      Save is locked until you preview &amp; confirm a real sample {scope === "receipt" ? "receipt" : "bill"}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "var(--fg-4)", margin: "0 0 0.5rem 0" }}>
                  Raw uploaded file (unfilled):
                </p>
                <img
                  src={uploadedImage}
                  alt="Template"
                  style={{ maxWidth: "100%", borderRadius: "8px" }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {/* PDF/image field-mapping / sample-preview modal */}
      {editorMode && mounted && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setEditorMode(null)}
        >
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: 12,
              width: "min(900px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>
                {editorMode === "image" ? "Image" : "PDF"} Field Mapping &amp; Sample Preview
                {scope === "receipt" ? " (Receipt)" : " (Bill)"}
              </h2>
              <button type="button" onClick={() => setEditorMode(null)} style={{ fontSize: 20, background: "none", border: "none", cursor: "pointer" }}>
                ✕
              </button>
            </div>

            {editorMode === "pdf" && pdfHasFormFields ? (
              <div style={{ background: "var(--primary-tint)", padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                This PDF has {detectedFields.length} fillable form fields. The system automatically
                matches each one (by name, case/space-insensitive) to the bill data below — no manual
                mapping needed. Detected fields:
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {detectedFields.map((f, i) => (
                    <span key={i} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <div style={{ background: "var(--warning-bg)", padding: 14, borderRadius: 8, marginBottom: 12, fontSize: 13, color: "var(--warning-fg)" }}>
                  {editorMode === "image"
                    ? "The system overlays (draws) text onto the uploaded image at fixed positions. Add the fields you want drawn and set their X/Y position (from the top-left corner, in points) and font size below."
                    : "No fillable form fields were detected, so the system overlays (draws) text onto the PDF at fixed positions instead. Add the fields you want drawn and set their X/Y position (from the top-left corner, in PDF points) and font size below."}
                </div>
                {(() => {
                  const fieldVocab = scope === "receipt" ? RECEIPT_OVERLAY_FIELD_KEYS : OVERLAY_FIELD_KEYS;
                  const activeFields = editorMode === "image" ? imageFields : pdfFields;
                  return (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {fieldVocab.filter((k) => !activeFields.some((f) => f.name === k.key)).map((k) => (
                          <button
                            key={k.key}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => addFieldToPDF(k.key)}
                          >
                            + {k.label}
                          </button>
                        ))}
                      </div>
                      {activeFields.length > 0 && (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: "var(--bg-sunken)" }}>
                              <th style={{ textAlign: "left", padding: 6 }}>Field</th>
                              <th style={{ padding: 6 }}>X</th>
                              <th style={{ padding: 6 }}>Y</th>
                              <th style={{ padding: 6 }}>Font size</th>
                              <th style={{ padding: 6 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeFields.map((f) => (
                              <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: 6 }}>
                                  {fieldVocab.find((k) => k.key === f.name)?.label || f.name}
                                </td>
                                <td style={{ padding: 6 }}>
                                  <input
                                    type="number"
                                    value={f.x}
                                    onChange={(e) => updateFieldProperty(f.id, "x", +e.target.value)}
                                    style={{ width: 70 }}
                                  />
                                </td>
                                <td style={{ padding: 6 }}>
                                  <input
                                    type="number"
                                    value={f.y}
                                    onChange={(e) => updateFieldProperty(f.id, "y", +e.target.value)}
                                    style={{ width: 70 }}
                                  />
                                </td>
                                <td style={{ padding: 6 }}>
                                  <input
                                    type="number"
                                    value={f.fontSize}
                                    onChange={(e) => updateFieldProperty(f.id, "fontSize", +e.target.value)}
                                    style={{ width: 60 }}
                                  />
                                </td>
                                <td style={{ padding: 6 }}>
                                  <button type="button" onClick={() => deleteField(f.id)} style={{ color: "red" }}>
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Preview as member:</label>
                <select value={previewMemberId} onChange={(e) => setPreviewMemberId(e.target.value)}>
                  {memberOptions.length === 0 ? <option value="">No members found</option> : null}
                  {memberOptions.map((m) => (
                    <option key={m._id} value={m._id}>
                      {(m.wing ? m.wing + "-" : "") + (m.flatNo || "")} · {m.ownerName || ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={previewFillMutation.isPending || !previewMemberId}
                  onClick={() => previewFillMutation.mutate()}
                >
                  {previewFillMutation.isPending ? "Rendering…" : "Generate sample preview"}
                </button>
              </div>
              {pdfPreviewError ? (
                <div style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
                  {pdfPreviewError}
                </div>
              ) : null}
              {pdfPreviewUrl ? (
                <>
                  <iframe
                    src={pdfPreviewUrl}
                    title={`Sample ${scope === "receipt" ? "receipt" : "bill"} preview`}
                    style={{ width: "100%", height: "500px", border: "2px solid var(--border)", borderRadius: 8, marginBottom: 12 }}
                  />
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => setPreviewConfirmed(true)}
                  >
                    {previewConfirmed ? "Confirmed — you can now save" : "Confirm this real-member sample"}
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--fg-4)" }}>
                  Generate a sample to see the real, filled-in PDF before confirming.
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}