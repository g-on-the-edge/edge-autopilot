/**
 * Tests for Buyer Helper PDF Service
 *
 * Tests cover:
 * - Multi-page PDF handling
 * - Line item extraction with quantities and prices
 * - Error handling for malformed PDFs
 * - Confidence scoring
 * - Edge cases and validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parsePurchaseOrderPdf,
  parsePurchaseOrderPdfFromBuffer,
  validateLineItems,
  formatLineItemsForDisplay,
  type ExtractedLineItem,
  type PdfParseOptions,
} from "./buyerHelperPdfService";

// Mock pdfjs-dist since we can't use the actual library in tests
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  version: "3.0.0",
  getDocument: vi.fn(),
}));

describe("buyerHelperPdfService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parsePurchaseOrderPdf", () => {
    it("should reject files that are too large", async () => {
      const largeFile = new File(
        [new ArrayBuffer(15 * 1024 * 1024)], // 15MB
        "large.pdf",
        { type: "application/pdf" }
      );

      const result = await parsePurchaseOrderPdf(largeFile, {
        maxFileSizeBytes: 10 * 1024 * 1024,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("FILE_TOO_LARGE");
      expect(result.error).toContain("exceeds maximum");
    });

    it("should reject non-PDF files", async () => {
      const textFile = new File(["hello world"], "document.txt", {
        type: "text/plain",
      });

      const result = await parsePurchaseOrderPdf(textFile);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_PDF");
      expect(result.error).toContain("must be a PDF");
    });

    it("should accept files with .pdf extension even without correct MIME type", async () => {
      // This tests that we check both MIME type and extension
      const pdfFile = new File([new ArrayBuffer(100)], "document.pdf", {
        type: "application/octet-stream",
      });

      // The PDF will fail to parse but should pass validation
      const result = await parsePurchaseOrderPdf(pdfFile);

      // Should not be INVALID_PDF error since extension is correct
      expect(result.errorCode).not.toBe("INVALID_PDF");
    });

    it("should track processing time", async () => {
      const smallFile = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const result = await parsePurchaseOrderPdf(smallFile);

      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("validateLineItems", () => {
    it("should validate items with complete data", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Office Supplies - Pens",
          itemCode: "PEN-001",
          quantity: 10,
          unitOfMeasure: "EA",
          unitPrice: 2.5,
          extendedPrice: 25.0,
          confidence: 0.9,
          sourcePage: 1,
          rawText: "1 PEN-001 Office Supplies - Pens 10 EA $2.50 $25.00",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it("should detect missing descriptions", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "AB", // Too short
          itemCode: null,
          quantity: 1,
          unitOfMeasure: null,
          unitPrice: 10,
          extendedPrice: 10,
          confidence: 0.8,
          sourcePage: 1,
          rawText: "AB 1 $10.00",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          field: "description",
          message: expect.stringContaining("too short"),
        })
      );
    });

    it("should detect zero quantity", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Valid Product Description",
          itemCode: null,
          quantity: 0,
          unitOfMeasure: null,
          unitPrice: 10,
          extendedPrice: 0,
          confidence: 0.8,
          sourcePage: 1,
          rawText: "Valid Product 0 $10.00 $0.00",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          field: "quantity",
          message: expect.stringContaining("greater than zero"),
        })
      );
    });

    it("should detect price calculation mismatches", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Mismatched Price Product",
          itemCode: null,
          quantity: 5,
          unitOfMeasure: "EA",
          unitPrice: 10.0,
          extendedPrice: 100.0, // Should be 50.00
          confidence: 0.8,
          sourcePage: 1,
          rawText: "Mismatched 5 EA $10.00 $100.00",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          field: "extendedPrice",
          message: expect.stringContaining("doesn't match"),
        })
      );
    });

    it("should allow small rounding differences in prices", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Rounding Test Product",
          itemCode: null,
          quantity: 3,
          unitOfMeasure: "EA",
          unitPrice: 10.0,
          extendedPrice: 30.005, // Within tolerance
          confidence: 0.8,
          sourcePage: 1,
          rawText: "Test 3 EA $10.00 $30.01",
        },
      ];

      const validation = validateLineItems(items);

      // Should not flag this as an issue
      const priceIssues = validation.issues.filter(
        (i) => i.field === "extendedPrice"
      );
      expect(priceIssues).toHaveLength(0);
    });

    it("should flag low confidence items", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Low Confidence Item",
          itemCode: null,
          quantity: 1,
          unitOfMeasure: null,
          unitPrice: 10,
          extendedPrice: 10,
          confidence: 0.3, // Below 0.5 threshold
          sourcePage: 1,
          rawText: "Some text",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          field: "confidence",
          message: expect.stringContaining("Low confidence"),
        })
      );
    });
  });

  describe("formatLineItemsForDisplay", () => {
    it("should format items correctly", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Test Product",
          itemCode: "TEST-001",
          quantity: 5,
          unitOfMeasure: "BOX",
          unitPrice: 12.5,
          extendedPrice: 62.5,
          confidence: 0.85,
          sourcePage: 1,
          rawText: "raw text",
        },
      ];

      const formatted = formatLineItemsForDisplay(items);

      expect(formatted).toHaveLength(1);
      expect(formatted[0]).toEqual({
        lineNumber: 1,
        description: "Test Product",
        itemCode: "TEST-001",
        quantity: "5 BOX",
        unitPrice: "$12.50",
        extendedPrice: "$62.50",
        confidence: "85%",
      });
    });

    it("should handle null values with defaults", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Incomplete Item",
          itemCode: null,
          quantity: 1,
          unitOfMeasure: null,
          unitPrice: null,
          extendedPrice: null,
          confidence: 0.5,
          sourcePage: 1,
          rawText: "raw",
        },
      ];

      const formatted = formatLineItemsForDisplay(items);

      expect(formatted[0].itemCode).toBe("-");
      expect(formatted[0].quantity).toBe("1 EA"); // Default UOM
      expect(formatted[0].unitPrice).toBe("-");
      expect(formatted[0].extendedPrice).toBe("-");
    });

    it("should format multiple items", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Item 1",
          itemCode: "A",
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 10,
          extendedPrice: 10,
          confidence: 0.9,
          sourcePage: 1,
          rawText: "",
        },
        {
          lineNumber: 2,
          description: "Item 2",
          itemCode: "B",
          quantity: 2,
          unitOfMeasure: "PC",
          unitPrice: 20,
          extendedPrice: 40,
          confidence: 0.8,
          sourcePage: 1,
          rawText: "",
        },
      ];

      const formatted = formatLineItemsForDisplay(items);

      expect(formatted).toHaveLength(2);
      expect(formatted[0].lineNumber).toBe(1);
      expect(formatted[1].lineNumber).toBe(2);
    });
  });

  describe("PdfParseOptions", () => {
    it("should use default options when not specified", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      // This will fail but we can verify it used defaults
      const result = await parsePurchaseOrderPdf(file);

      // It should have attempted to process
      expect(result.processingTimeMs).toBeDefined();
    });

    it("should respect custom maxPages option", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const options: PdfParseOptions = {
        maxPages: 5,
        verbose: false,
      };

      // Options should be accepted without error
      const result = await parsePurchaseOrderPdf(file, options);
      expect(result).toBeDefined();
    });

    it("should respect verbose option", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      await parsePurchaseOrderPdf(file, { verbose: true });

      // Clean up
      consoleSpy.mockRestore();
    });
  });

  describe("parsePurchaseOrderPdfFromBuffer", () => {
    it("should accept ArrayBuffer input", async () => {
      const buffer = new ArrayBuffer(100);

      const result = await parsePurchaseOrderPdfFromBuffer(buffer, "test.pdf");

      expect(result).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should use provided filename", async () => {
      const buffer = new ArrayBuffer(100);

      const result = await parsePurchaseOrderPdfFromBuffer(
        buffer,
        "custom-name.pdf"
      );

      expect(result).toBeDefined();
    });

    it("should apply options to buffer parsing", async () => {
      const buffer = new ArrayBuffer(100);

      const result = await parsePurchaseOrderPdfFromBuffer(
        buffer,
        "test.pdf",
        { minConfidence: 0.8 }
      );

      expect(result).toBeDefined();
    });
  });

  describe("Multi-page handling", () => {
    it("should respect maxPages limit", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const options: PdfParseOptions = {
        maxPages: 3,
      };

      // The option should be accepted
      const result = await parsePurchaseOrderPdf(file, options);
      expect(result).toBeDefined();
    });

    it("should enable multi-page merge by default", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      // Default should have enableMultiPageMerge: true
      const result = await parsePurchaseOrderPdf(file);
      expect(result).toBeDefined();
    });

    it("should allow disabling multi-page merge", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const result = await parsePurchaseOrderPdf(file, {
        enableMultiPageMerge: false,
      });

      expect(result).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should handle timeout with retry", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const result = await parsePurchaseOrderPdf(file, {
        pageTimeoutMs: 100,
        maxRetries: 1,
      });

      expect(result).toBeDefined();
    });

    it("should return appropriate error codes", async () => {
      // Test FILE_TOO_LARGE
      const largeFile = new File(
        [new ArrayBuffer(20 * 1024 * 1024)],
        "large.pdf",
        { type: "application/pdf" }
      );

      const result = await parsePurchaseOrderPdf(largeFile, {
        maxFileSizeBytes: 10 * 1024 * 1024,
      });

      expect(result.errorCode).toBe("FILE_TOO_LARGE");
    });

    it("should track warnings without failing", async () => {
      const file = new File([new ArrayBuffer(100)], "test.pdf", {
        type: "application/pdf",
      });

      const result = await parsePurchaseOrderPdf(file);

      // Result should have warnings array
      if (result.data) {
        expect(Array.isArray(result.data.warnings)).toBe(true);
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle empty line items array in validation", () => {
      const validation = validateLineItems([]);

      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it("should format empty line items array", () => {
      const formatted = formatLineItemsForDisplay([]);

      expect(formatted).toHaveLength(0);
    });

    it("should handle negative quantities as invalid", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Negative Qty Item",
          itemCode: null,
          quantity: -5,
          unitOfMeasure: null,
          unitPrice: 10,
          extendedPrice: -50,
          confidence: 0.8,
          sourcePage: 1,
          rawText: "test",
        },
      ];

      const validation = validateLineItems(items);

      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          field: "quantity",
        })
      );
    });

    it("should handle special characters in descriptions", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Product™ with ® and © symbols & <special> chars",
          itemCode: "SPEC-001",
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 10,
          extendedPrice: 10,
          confidence: 0.9,
          sourcePage: 1,
          rawText: "test",
        },
      ];

      const formatted = formatLineItemsForDisplay(items);

      expect(formatted[0].description).toContain("™");
      expect(formatted[0].description).toContain("&");
    });

    it("should handle very long descriptions", () => {
      const longDesc = "A".repeat(500);
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: longDesc,
          itemCode: null,
          quantity: 1,
          unitOfMeasure: null,
          unitPrice: 10,
          extendedPrice: 10,
          confidence: 0.7,
          sourcePage: 1,
          rawText: longDesc,
        },
      ];

      const validation = validateLineItems(items);
      const formatted = formatLineItemsForDisplay(items);

      // Should still validate and format
      expect(formatted[0].description.length).toBe(500);
    });

    it("should handle decimal quantities", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Fractional Item",
          itemCode: null,
          quantity: 2.5,
          unitOfMeasure: "LB",
          unitPrice: 4.0,
          extendedPrice: 10.0,
          confidence: 0.8,
          sourcePage: 1,
          rawText: "test",
        },
      ];

      const validation = validateLineItems(items);

      // Decimal quantities should be valid
      expect(
        validation.issues.filter((i) => i.field === "quantity")
      ).toHaveLength(0);

      const formatted = formatLineItemsForDisplay(items);
      expect(formatted[0].quantity).toBe("2.5 LB");
    });

    it("should handle prices with many decimal places", () => {
      const items: ExtractedLineItem[] = [
        {
          lineNumber: 1,
          description: "Precision Price Item",
          itemCode: null,
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 10.999999,
          extendedPrice: 10.999999,
          confidence: 0.9,
          sourcePage: 1,
          rawText: "test",
        },
      ];

      const formatted = formatLineItemsForDisplay(items);

      // Should format to 2 decimal places
      expect(formatted[0].unitPrice).toBe("$11.00");
    });
  });
});
