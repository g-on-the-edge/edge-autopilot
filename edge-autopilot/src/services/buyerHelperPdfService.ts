/**
 * Buyer Helper PDF Service
 *
 * Service for parsing purchase order PDFs to extract line items,
 * quantities, prices, and other relevant data for the Buyer Helper app.
 *
 * Features:
 * - Multi-page PDF support with page continuation detection
 * - Line item extraction with quantities and prices
 * - Robust error handling for malformed PDFs
 * - Confidence scoring for extracted data
 * - Table structure detection with column position tracking
 * - Split line item merging across pages
 */

import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ============================================================================
// Types
// ============================================================================

export interface ExtractedLineItem {
  /** Line item number or index */
  lineNumber: number;
  /** Item description or name */
  description: string;
  /** Item SKU, part number, or catalog number */
  itemCode: string | null;
  /** Quantity ordered */
  quantity: number;
  /** Unit of measure (e.g., EA, BOX, CASE) */
  unitOfMeasure: string | null;
  /** Unit price */
  unitPrice: number | null;
  /** Extended price (quantity * unit price) */
  extendedPrice: number | null;
  /** Confidence score for this extraction (0-1) */
  confidence: number;
  /** Source page number in the PDF */
  sourcePage: number;
  /** Raw text that was parsed */
  rawText: string;
}

export interface PurchaseOrderHeader {
  /** PO number */
  poNumber: string | null;
  /** Order date */
  orderDate: string | null;
  /** Vendor/Supplier name */
  vendorName: string | null;
  /** Vendor address */
  vendorAddress: string | null;
  /** Ship-to address */
  shipToAddress: string | null;
  /** Bill-to address */
  billToAddress: string | null;
  /** Payment terms */
  paymentTerms: string | null;
  /** Shipping method */
  shippingMethod: string | null;
}

export interface PurchaseOrderTotals {
  /** Subtotal before tax */
  subtotal: number | null;
  /** Tax amount */
  tax: number | null;
  /** Shipping/freight charges */
  shipping: number | null;
  /** Grand total */
  grandTotal: number | null;
}

export interface ParsedPurchaseOrder {
  /** Header information */
  header: PurchaseOrderHeader;
  /** Extracted line items */
  lineItems: ExtractedLineItem[];
  /** Order totals */
  totals: PurchaseOrderTotals;
  /** Overall confidence score */
  overallConfidence: number;
  /** Total pages in the PDF */
  totalPages: number;
  /** Pages successfully parsed */
  pagesParsed: number;
  /** Warnings during parsing */
  warnings: string[];
}

export interface PdfParseResult {
  success: boolean;
  data: ParsedPurchaseOrder | null;
  error?: string;
  errorCode?: PdfParseErrorCode;
  processingTimeMs: number;
}

export type PdfParseErrorCode =
  | "INVALID_PDF"
  | "CORRUPTED_PDF"
  | "PASSWORD_PROTECTED"
  | "EMPTY_PDF"
  | "NO_TEXT_CONTENT"
  | "EXTRACTION_FAILED"
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "PAGE_TIMEOUT"
  | "UNKNOWN_ERROR";

export interface PdfParseOptions {
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSizeBytes?: number;
  /** Maximum pages to process (default: 50) */
  maxPages?: number;
  /** Minimum confidence threshold for line items (default: 0.5) */
  minConfidence?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable multi-page line item merging (default: true) */
  enableMultiPageMerge?: boolean;
  /** Maximum retry attempts for failed pages (default: 2) */
  maxRetries?: number;
  /** Timeout per page in milliseconds (default: 5000) */
  pageTimeoutMs?: number;
}

/**
 * Represents detected table column positions for structured extraction
 */
interface TableColumnPositions {
  lineNumberX?: number;
  itemCodeX?: number;
  descriptionX?: number;
  quantityX?: number;
  unitPriceX?: number;
  extendedPriceX?: number;
}

/**
 * Represents a text item with position information
 */
interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Context for multi-page parsing to handle continuations
 */
interface MultiPageContext {
  /** Detected table column positions from first page with table */
  columnPositions: TableColumnPositions | null;
  /** Last incomplete line item that may continue on next page */
  pendingLineItem: Partial<ExtractedLineItem> | null;
  /** Whether we're in the middle of a line items table */
  inLineItemsSection: boolean;
  /** Last page's ending Y position for continuity detection */
  lastPageEndY: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<PdfParseOptions> = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxPages: 50,
  minConfidence: 0.5,
  verbose: false,
  enableMultiPageMerge: true,
  maxRetries: 2,
  pageTimeoutMs: 5000,
};

// Regex patterns for extraction
const PATTERNS = {
  // PO Number patterns
  poNumber: [
    /(?:P\.?O\.?|Purchase\s*Order)\s*(?:Number|No\.?|#)?\s*:?\s*([A-Z0-9-]+)/i,
    /(?:Order\s*(?:Number|No\.?|#))\s*:?\s*([A-Z0-9-]+)/i,
  ],

  // Date patterns
  date: [
    /(?:Date|Order\s*Date|PO\s*Date)\s*:?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
  ],

  // Price patterns (matches $1,234.56 or 1234.56)
  price: /\$?\s*([\d,]+\.?\d*)/,

  // Quantity patterns
  quantity: /(\d+(?:\.\d+)?)\s*(?:EA|PC|BOX|CS|CASE|EACH|PK|PKG|BX|CT|DZ|PR)?/i,

  // Unit of measure
  unitOfMeasure: /\b(EA|PC|BOX|CS|CASE|EACH|PK|PKG|BX|CT|DZ|PR|SET|KIT|RL|ROLL)\b/i,

  // Item/SKU code patterns
  itemCode: [
    /(?:Item|SKU|Part|Catalog|Product)\s*(?:No\.?|#|Code)?\s*:?\s*([A-Z0-9\-]+)/i,
    /^([A-Z]{2,}[\d\-]+[A-Z0-9\-]*)/i,
  ],

  // Line item pattern - tries to match: [item#] [description] [qty] [unit price] [ext price]
  lineItem:
    /^(\d+)?\s*([A-Z0-9\-]+)?\s+(.{10,}?)\s+(\d+(?:\.\d+)?)\s*(?:EA|PC|BOX|CS|CASE|EACH)?\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/i,

  // Totals patterns
  subtotal: /(?:Sub\s*total|Subtotal)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
  tax: /(?:Tax|Sales\s*Tax|VAT)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
  shipping: /(?:Shipping|Freight|S&H|S\/H)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
  grandTotal: /(?:Grand\s*Total|Total|Amount\s*Due)\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,

  // Vendor/address patterns
  vendorName: /(?:Vendor|Supplier|From)\s*:?\s*(.+?)(?:\n|$)/i,
  shipTo: /(?:Ship\s*To|Shipping\s*Address|Deliver\s*To)\s*:?\s*([\s\S]+?)(?:\n\n|Bill|Payment)/i,
  billTo: /(?:Bill\s*To|Billing\s*Address|Invoice\s*To)\s*:?\s*([\s\S]+?)(?:\n\n|Ship|Payment)/i,

  // Additional line item patterns for various PO formats
  lineItemVariants: [
    // Format: line# | item code | description | qty | unit price | ext price
    /^(\d+)\s+([A-Z0-9\-]{3,})\s+(.{5,}?)\s+(\d+(?:\.\d+)?)\s*(?:EA|PC|BOX|CS)?\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/i,
    // Format: item code | description | qty | price (no line number)
    /^([A-Z0-9\-]{3,})\s+(.{10,}?)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)$/i,
    // Format: description only with qty and price at end
    /^(.{15,}?)\s+(\d+(?:\.\d+)?)\s*(?:EA|PC|BOX|CS|CASE|EACH)?\s+\$?([\d,]+\.?\d*)\s*(?:\$?([\d,]+\.?\d*))?$/i,
    // Format: numbered list with description and price
    /^(\d+)[.\)]\s*(.{10,}?)\s+\$?([\d,]+\.?\d*)$/i,
  ],

  // Table header detection patterns
  tableHeaders: [
    /item\s*(?:#|no|number)?/i,
    /description|product|name/i,
    /qty|quantity|ordered/i,
    /(?:unit\s*)?price/i,
    /(?:ext(?:ended)?|total)\s*(?:price|amount)?/i,
    /amount|total/i,
  ],

  // Page continuation indicators
  pageContinuation: [
    /continued\s*(?:on\s*next\s*page|from\s*previous)/i,
    /page\s*\d+\s*of\s*\d+/i,
    /\(continued\)/i,
    /---\s*continued\s*---/i,
  ],

  // Section end indicators
  sectionEnd: [
    /^(?:sub)?total/i,
    /^(?:grand\s*)?total/i,
    /^tax/i,
    /^shipping|freight/i,
    /^notes?:/i,
    /^terms?:/i,
    /^payment/i,
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a price string to a number
 */
function parsePrice(priceStr: string | null | undefined): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse a quantity string to a number
 */
function parseQuantity(qtyStr: string | null | undefined): number {
  if (!qtyStr) return 0;
  const cleaned = qtyStr.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extract text content from a PDF page with position information
 */
async function extractPageTextWithPositions(
  page: pdfjsLib.PDFPageProxy
): Promise<{ text: string; items: PositionedTextItem[] }> {
  const textContent = await page.getTextContent();
  const textItems = textContent.items as Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
  }>;

  // Convert to positioned items
  const positionedItems: PositionedTextItem[] = textItems
    .filter((item) => item.str.trim().length > 0)
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: item.height || Math.abs(item.transform[3]) || 12,
    }));

  // Sort items by vertical position (y) then horizontal (x)
  const sortedItems = [...positionedItems].sort((a, b) => {
    const yDiff = b.y - a.y; // Descending Y (top to bottom)
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.x - b.x; // Ascending X (left to right)
  });

  // Group items by line (similar Y position)
  const lines: PositionedTextItem[][] = [];
  let currentLine: PositionedTextItem[] = [];
  let lastY = sortedItems[0]?.y ?? 0;

  for (const item of sortedItems) {
    if (Math.abs(item.y - lastY) > 5) {
      // New line
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
      currentLine = [item];
      lastY = item.y;
    } else {
      currentLine.push(item);
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const text = lines.map((line) => line.map((item) => item.text).join(" ")).join("\n");
  return { text, items: positionedItems };
}

/**
 * Extract text content from a PDF page (legacy function for compatibility)
 */
async function extractPageText(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const { text } = await extractPageTextWithPositions(page);
  return text;
}

/**
 * Detect table column positions from header row
 */
function detectTableColumns(items: PositionedTextItem[], lineY: number): TableColumnPositions | null {
  // Find items on the same line as the potential header
  const headerItems = items.filter((item) => Math.abs(item.y - lineY) < 5);
  if (headerItems.length < 3) return null;

  const columns: TableColumnPositions = {};
  const sortedByX = [...headerItems].sort((a, b) => a.x - b.x);

  for (const item of sortedByX) {
    const text = item.text.toLowerCase();
    if (/item|line|#|no\.?/.test(text) && !columns.lineNumberX) {
      columns.lineNumberX = item.x;
    } else if (/sku|code|part|catalog/.test(text) && !columns.itemCodeX) {
      columns.itemCodeX = item.x;
    } else if (/desc|product|name/.test(text) && !columns.descriptionX) {
      columns.descriptionX = item.x;
    } else if (/qty|quantity|ordered/.test(text) && !columns.quantityX) {
      columns.quantityX = item.x;
    } else if (/unit.*price|price.*unit|each/.test(text) && !columns.unitPriceX) {
      columns.unitPriceX = item.x;
    } else if (/ext|total|amount/.test(text) && !columns.extendedPriceX) {
      columns.extendedPriceX = item.x;
    }
  }

  // Need at least description and one price column to be useful
  return columns.descriptionX && (columns.unitPriceX || columns.extendedPriceX) ? columns : null;
}

/**
 * Check if a line indicates the end of the line items section
 */
function isSectionEndLine(line: string): boolean {
  const trimmed = line.trim();
  return PATTERNS.sectionEnd.some((pattern) => pattern.test(trimmed));
}

/**
 * Check if text indicates a page continuation
 */
function isPageContinuation(text: string): boolean {
  return PATTERNS.pageContinuation.some((pattern) => pattern.test(text));
}

/**
 * Check if a line looks like a table header
 */
function isTableHeaderLine(line: string): boolean {
  const matches = PATTERNS.tableHeaders.filter((pattern) => pattern.test(line));
  return matches.length >= 2;
}

/**
 * Execute with timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, lastError);
        // Exponential backoff: 100ms, 200ms, 400ms...
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError;
}

/**
 * Extract header information from PDF text
 */
function extractHeader(text: string): PurchaseOrderHeader {
  const header: PurchaseOrderHeader = {
    poNumber: null,
    orderDate: null,
    vendorName: null,
    vendorAddress: null,
    shipToAddress: null,
    billToAddress: null,
    paymentTerms: null,
    shippingMethod: null,
  };

  // Extract PO Number
  for (const pattern of PATTERNS.poNumber) {
    const match = text.match(pattern);
    if (match) {
      header.poNumber = match[1].trim();
      break;
    }
  }

  // Extract Date
  for (const pattern of PATTERNS.date) {
    const match = text.match(pattern);
    if (match) {
      header.orderDate = match[1].trim();
      break;
    }
  }

  // Extract Vendor Name
  const vendorMatch = text.match(PATTERNS.vendorName);
  if (vendorMatch) {
    header.vendorName = vendorMatch[1].trim();
  }

  // Extract Ship To Address
  const shipToMatch = text.match(PATTERNS.shipTo);
  if (shipToMatch) {
    header.shipToAddress = shipToMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract Bill To Address
  const billToMatch = text.match(PATTERNS.billTo);
  if (billToMatch) {
    header.billToAddress = billToMatch[1].trim().replace(/\s+/g, " ");
  }

  return header;
}

/**
 * Extract totals from PDF text
 */
function extractTotals(text: string): PurchaseOrderTotals {
  const totals: PurchaseOrderTotals = {
    subtotal: null,
    tax: null,
    shipping: null,
    grandTotal: null,
  };

  const subtotalMatch = text.match(PATTERNS.subtotal);
  if (subtotalMatch) {
    totals.subtotal = parsePrice(subtotalMatch[1]);
  }

  const taxMatch = text.match(PATTERNS.tax);
  if (taxMatch) {
    totals.tax = parsePrice(taxMatch[1]);
  }

  const shippingMatch = text.match(PATTERNS.shipping);
  if (shippingMatch) {
    totals.shipping = parsePrice(shippingMatch[1]);
  }

  const totalMatch = text.match(PATTERNS.grandTotal);
  if (totalMatch) {
    totals.grandTotal = parsePrice(totalMatch[1]);
  }

  return totals;
}

/**
 * Check if two descriptions are similar (for deduplication)
 */
function isSimilarDescription(desc1: string, desc2: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const n1 = normalize(desc1);
  const n2 = normalize(desc2);

  if (n1 === n2) return true;

  // Check if one contains the other (for truncated descriptions)
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Simple similarity check - first 20 chars match
  if (n1.substring(0, 20) === n2.substring(0, 20)) return true;

  return false;
}

/**
 * Check if a line item appears incomplete (missing required data)
 */
function isIncompleteLineItem(item: ExtractedLineItem): boolean {
  // Item is incomplete if it has description but missing price info
  // and the description ends mid-word or with continuation indicators
  if (item.unitPrice === null && item.extendedPrice === null) {
    const desc = item.description.trim();
    // Check for truncation indicators
    if (desc.endsWith("...") || desc.endsWith("-") || desc.length > 100) {
      return true;
    }
  }
  return false;
}

/**
 * Try to complete a pending item from previous page using lines from current page
 */
function tryCompletePendingItem(
  lines: string[],
  pending: Partial<ExtractedLineItem>,
  pageNumber: number
): ExtractedLineItem | null {
  // Look at first few lines for continuation data
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip if this looks like a new item or header
    if (isTableHeaderLine(line)) continue;
    if (/^\d+[\.\)]\s/.test(line)) continue;

    // Try to extract price from this line
    const priceMatches = line.match(/\$?\s*([\d,]+\.?\d*)/g);
    if (priceMatches && priceMatches.length > 0) {
      const prices = priceMatches.map((p) => parsePrice(p)).filter((p) => p !== null);

      if (prices.length > 0) {
        return {
          lineNumber: pending.lineNumber || 0,
          description: (pending.description || "") + " " + line.replace(/\$?\s*[\d,]+\.?\d*/g, "").trim(),
          itemCode: pending.itemCode || null,
          quantity: pending.quantity || 1,
          unitOfMeasure: pending.unitOfMeasure || null,
          unitPrice: prices[0] ?? null,
          extendedPrice: prices.length > 1 ? (prices[prices.length - 1] ?? null) : null,
          confidence: 0.6, // Lower confidence for continued items
          sourcePage: pageNumber,
          rawText: `[continued] ${line}`,
        };
      }
    }
  }

  return null;
}

/**
 * Extract line items from text using multiple strategies with multi-page context
 */
function extractLineItems(
  text: string,
  pageNumber: number,
  context?: MultiPageContext
): { items: ExtractedLineItem[]; updatedContext: MultiPageContext } {
  const lineItems: ExtractedLineItem[] = [];
  const lines = text.split("\n");

  // Initialize or use existing context
  const ctx: MultiPageContext = context || {
    columnPositions: null,
    pendingLineItem: null,
    inLineItemsSection: false,
    lastPageEndY: 0,
  };

  // Check for continuation from previous page
  if (ctx.pendingLineItem && pageNumber > 1) {
    const continuationItem = tryCompletePendingItem(lines, ctx.pendingLineItem, pageNumber);
    if (continuationItem) {
      lineItems.push(continuationItem);
      ctx.pendingLineItem = null;
    }
  }

  // Strategy 1: Look for tabular data with clear columns
  const tableLineItems = extractTableLineItems(lines, pageNumber);
  if (tableLineItems.length > 0) {
    lineItems.push(...tableLineItems);
    ctx.inLineItemsSection = true;
  }

  // Strategy 2: Look for structured line item patterns using variant patterns
  const variantLineItems = extractVariantPatternLineItems(lines, pageNumber);
  for (const item of variantLineItems) {
    // Avoid duplicates based on description similarity
    const isDuplicate = lineItems.some(
      (existing) =>
        isSimilarDescription(existing.description, item.description) &&
        existing.quantity === item.quantity
    );
    if (!isDuplicate) {
      lineItems.push(item);
    }
  }

  // Strategy 3: Look for structured line item patterns (original)
  const patternLineItems = extractPatternLineItems(lines, pageNumber);
  for (const item of patternLineItems) {
    // Avoid duplicates
    const isDuplicate = lineItems.some(
      (existing) =>
        isSimilarDescription(existing.description, item.description) &&
        existing.quantity === item.quantity
    );
    if (!isDuplicate) {
      lineItems.push(item);
    }
  }

  // Strategy 4: Heuristic-based extraction for less structured PDFs
  if (lineItems.length === 0) {
    const heuristicItems = extractHeuristicLineItems(lines, pageNumber);
    lineItems.push(...heuristicItems);
  }

  // Check for incomplete items at end of page that might continue
  const lastItem = lineItems[lineItems.length - 1];
  if (lastItem && isIncompleteLineItem(lastItem)) {
    ctx.pendingLineItem = lastItem;
    lineItems.pop(); // Remove incomplete item, will be completed on next page
  }

  return { items: lineItems, updatedContext: ctx };
}

/**
 * Extract line items using variant patterns
 */
function extractVariantPatternLineItems(lines: string[], pageNumber: number): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  let lineNumber = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    // Skip headers and section markers
    if (isTableHeaderLine(trimmed)) continue;
    if (isSectionEndLine(trimmed)) continue;

    // Try each variant pattern
    for (const pattern of PATTERNS.lineItemVariants) {
      const match = trimmed.match(pattern);
      if (match) {
        const item = parseVariantMatch(match, pattern, lineNumber++, pageNumber, trimmed);
        if (item) {
          items.push(item);
          break; // Don't try other patterns for this line
        }
      }
    }
  }

  return items;
}

/**
 * Parse a regex match into a line item based on the pattern used
 */
function parseVariantMatch(
  match: RegExpMatchArray,
  pattern: RegExp,
  lineNumber: number,
  pageNumber: number,
  rawText: string
): ExtractedLineItem | null {
  const patternStr = pattern.source;

  // Pattern 1: line# | item code | description | qty | unit price | ext price
  if (patternStr.includes("([A-Z0-9\\-]{3,})") && match.length >= 7) {
    return {
      lineNumber: parseInt(match[1]) || lineNumber,
      description: match[3]?.trim() || "",
      itemCode: match[2] || null,
      quantity: parseQuantity(match[4]),
      unitOfMeasure: extractUnitOfMeasure(rawText),
      unitPrice: parsePrice(match[5]),
      extendedPrice: parsePrice(match[6]),
      confidence: 0.9,
      sourcePage: pageNumber,
      rawText,
    };
  }

  // Pattern 2: item code | description | qty | price
  if (match.length >= 5 && !patternStr.startsWith("^(\\d+)")) {
    return {
      lineNumber,
      description: match[2]?.trim() || "",
      itemCode: match[1] || null,
      quantity: parseQuantity(match[3]),
      unitOfMeasure: extractUnitOfMeasure(rawText),
      unitPrice: parsePrice(match[4]),
      extendedPrice: null,
      confidence: 0.75,
      sourcePage: pageNumber,
      rawText,
    };
  }

  // Pattern 3 & 4: simpler formats
  if (match.length >= 3) {
    const hasLineNum = /^\d+[.\)]/.test(rawText);
    return {
      lineNumber: hasLineNum && match[1] ? parseInt(match[1]) : lineNumber,
      description: match[hasLineNum ? 2 : 1]?.trim() || "",
      itemCode: null,
      quantity: parseQuantity(match[hasLineNum ? 3 : 2] || "1"),
      unitOfMeasure: extractUnitOfMeasure(rawText),
      unitPrice: parsePrice(match[match.length - 1]),
      extendedPrice: match.length > 4 ? parsePrice(match[match.length - 1]) : null,
      confidence: 0.65,
      sourcePage: pageNumber,
      rawText,
    };
  }

  return null;
}

/**
 * Extract line items from tabular format
 */
function extractTableLineItems(lines: string[], pageNumber: number): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  let lineNumber = 1;

  // Look for lines that match the pattern: description + quantity + prices
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.length < 10) continue;

    // Skip header rows
    if (/^(item|description|qty|quantity|price|amount|sku|part)/i.test(trimmedLine)) {
      continue;
    }

    // Try to match line item pattern
    const match = trimmedLine.match(PATTERNS.lineItem);
    if (match) {
      const [, itemNum, itemCode, description, qty, unitPrice, extPrice] = match;

      items.push({
        lineNumber: itemNum ? parseInt(itemNum) : lineNumber++,
        description: description.trim(),
        itemCode: itemCode || null,
        quantity: parseQuantity(qty),
        unitOfMeasure: extractUnitOfMeasure(trimmedLine),
        unitPrice: parsePrice(unitPrice),
        extendedPrice: parsePrice(extPrice),
        confidence: 0.85,
        sourcePage: pageNumber,
        rawText: trimmedLine,
      });
    }
  }

  return items;
}

/**
 * Extract line items using pattern matching
 */
function extractPatternLineItems(lines: string[], pageNumber: number): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  let lineNumber = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 5) continue;

    // Look for lines with price patterns
    const priceMatches = line.match(/\$?\s*[\d,]+\.?\d{0,2}/g);
    if (!priceMatches || priceMatches.length < 1) continue;

    // Extract quantity
    const qtyMatch = line.match(PATTERNS.quantity);
    if (!qtyMatch) continue;

    // This looks like a line item
    const quantity = parseQuantity(qtyMatch[1]);
    if (quantity <= 0) continue;

    // Extract prices
    const prices = priceMatches.map((p) => parsePrice(p)).filter((p) => p !== null) as number[];

    // Determine description (everything before the quantity)
    const qtyIndex = line.indexOf(qtyMatch[0]);
    let description = line.substring(0, qtyIndex).trim();

    // Extract item code if present
    let itemCode: string | null = null;
    for (const pattern of PATTERNS.itemCode) {
      const codeMatch = description.match(pattern);
      if (codeMatch) {
        itemCode = codeMatch[1];
        description = description.replace(codeMatch[0], "").trim();
        break;
      }
    }

    // Clean up description
    description = description.replace(/^\d+[\.\)]\s*/, "").trim();
    if (description.length < 3) continue;

    items.push({
      lineNumber: lineNumber++,
      description,
      itemCode,
      quantity,
      unitOfMeasure: extractUnitOfMeasure(line),
      unitPrice: prices.length >= 1 ? prices[0] : null,
      extendedPrice: prices.length >= 2 ? prices[prices.length - 1] : null,
      confidence: 0.7,
      sourcePage: pageNumber,
      rawText: line,
    });
  }

  return items;
}

/**
 * Heuristic-based extraction for unstructured PDFs
 */
function extractHeuristicLineItems(lines: string[], pageNumber: number): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  let lineNumber = 1;
  let currentItem: Partial<ExtractedLineItem> | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      // Empty line might indicate end of item
      if (currentItem && currentItem.description) {
        items.push({
          lineNumber: lineNumber++,
          description: currentItem.description,
          itemCode: currentItem.itemCode || null,
          quantity: currentItem.quantity || 1,
          unitOfMeasure: currentItem.unitOfMeasure || null,
          unitPrice: currentItem.unitPrice || null,
          extendedPrice: currentItem.extendedPrice || null,
          confidence: 0.5,
          sourcePage: pageNumber,
          rawText: currentItem.rawText || currentItem.description,
        });
        currentItem = null;
      }
      continue;
    }

    // Check if line contains a price
    const hasPrice = /\$?\s*[\d,]+\.\d{2}/.test(trimmedLine);
    const hasQuantity = /\b\d+\s*(?:EA|PC|BOX|CS|CASE|EACH)?\b/i.test(trimmedLine);

    if (hasPrice || hasQuantity) {
      // Extract data from this line
      const priceMatch = trimmedLine.match(PATTERNS.price);
      const qtyMatch = trimmedLine.match(PATTERNS.quantity);

      if (!currentItem) {
        currentItem = {
          description: trimmedLine.replace(PATTERNS.price, "").replace(PATTERNS.quantity, "").trim(),
          rawText: trimmedLine,
        };
      }

      if (qtyMatch) {
        currentItem.quantity = parseQuantity(qtyMatch[1]);
      }
      if (priceMatch) {
        const price = parsePrice(priceMatch[1]);
        if (!currentItem.unitPrice) {
          currentItem.unitPrice = price;
        } else {
          currentItem.extendedPrice = price;
        }
      }
      currentItem.unitOfMeasure = extractUnitOfMeasure(trimmedLine);
    } else if (trimmedLine.length > 10 && !currentItem) {
      // This might be a description line
      currentItem = {
        description: trimmedLine,
        rawText: trimmedLine,
      };
    } else if (currentItem) {
      // Append to description
      currentItem.description += " " + trimmedLine;
      currentItem.rawText = (currentItem.rawText || "") + " " + trimmedLine;
    }
  }

  // Don't forget the last item
  if (currentItem && currentItem.description) {
    items.push({
      lineNumber: lineNumber,
      description: currentItem.description,
      itemCode: currentItem.itemCode || null,
      quantity: currentItem.quantity || 1,
      unitOfMeasure: currentItem.unitOfMeasure || null,
      unitPrice: currentItem.unitPrice || null,
      extendedPrice: currentItem.extendedPrice || null,
      confidence: 0.4,
      sourcePage: pageNumber,
      rawText: currentItem.rawText || currentItem.description,
    });
  }

  return items;
}

/**
 * Extract unit of measure from text
 */
function extractUnitOfMeasure(text: string): string | null {
  const match = text.match(PATTERNS.unitOfMeasure);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Calculate overall confidence score
 */
function calculateOverallConfidence(data: ParsedPurchaseOrder): number {
  const factors: number[] = [];

  // Header completeness
  const headerFields = Object.values(data.header).filter((v) => v !== null).length;
  factors.push(headerFields / 8);

  // Line items confidence
  if (data.lineItems.length > 0) {
    const avgItemConfidence =
      data.lineItems.reduce((sum, item) => sum + item.confidence, 0) / data.lineItems.length;
    factors.push(avgItemConfidence);
  } else {
    factors.push(0);
  }

  // Totals completeness
  const totalsFields = Object.values(data.totals).filter((v) => v !== null).length;
  factors.push(totalsFields / 4);

  // Pages parsed ratio
  factors.push(data.pagesParsed / data.totalPages);

  // Calculate weighted average
  const weights = [0.2, 0.4, 0.2, 0.2];
  return factors.reduce((sum, factor, i) => sum + factor * weights[i], 0);
}

/**
 * Merge duplicate line items that may appear across pages
 */
function mergeLineItems(items: ExtractedLineItem[]): ExtractedLineItem[] {
  const merged: ExtractedLineItem[] = [];
  const seen = new Map<string, number>();

  for (const item of items) {
    // Create a key based on description and item code
    const key = `${item.description.toLowerCase().substring(0, 30)}_${item.itemCode || ""}`;
    const existingIndex = seen.get(key);

    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      // Merge: keep higher confidence values
      if (item.confidence > existing.confidence) {
        merged[existingIndex] = {
          ...item,
          quantity: existing.quantity + item.quantity,
          extendedPrice:
            existing.extendedPrice !== null && item.extendedPrice !== null
              ? existing.extendedPrice + item.extendedPrice
              : item.extendedPrice ?? existing.extendedPrice,
        };
      } else {
        // Add quantities
        merged[existingIndex].quantity += item.quantity;
        if (item.extendedPrice !== null) {
          merged[existingIndex].extendedPrice =
            (merged[existingIndex].extendedPrice || 0) + item.extendedPrice;
        }
      }
    } else {
      seen.set(key, merged.length);
      merged.push({ ...item });
    }
  }

  // Renumber
  merged.forEach((item, index) => {
    item.lineNumber = index + 1;
  });

  return merged;
}

// ============================================================================
// Main API Functions
// ============================================================================

/**
 * Parse a purchase order PDF file
 *
 * @param file - The PDF file to parse
 * @param options - Parsing options
 * @returns Parsed purchase order data
 */
export async function parsePurchaseOrderPdf(
  file: File,
  options: PdfParseOptions = {}
): Promise<PdfParseResult> {
  const startTime = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate file size
  if (file.size > opts.maxFileSizeBytes) {
    return {
      success: false,
      data: null,
      error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed ${(opts.maxFileSizeBytes / 1024 / 1024).toFixed(2)}MB`,
      errorCode: "FILE_TOO_LARGE",
      processingTimeMs: performance.now() - startTime,
    };
  }

  // Validate file type
  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return {
      success: false,
      data: null,
      error: "File must be a PDF document",
      errorCode: "INVALID_PDF",
      processingTimeMs: performance.now() - startTime,
    };
  }

  try {
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load PDF document
    let pdf: pdfjsLib.PDFDocumentProxy;
    try {
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (loadError) {
      const errorMessage = loadError instanceof Error ? loadError.message : String(loadError);

      if (errorMessage.includes("password")) {
        return {
          success: false,
          data: null,
          error: "PDF is password protected",
          errorCode: "PASSWORD_PROTECTED",
          processingTimeMs: performance.now() - startTime,
        };
      }

      if (errorMessage.includes("Invalid") || errorMessage.includes("corrupt")) {
        return {
          success: false,
          data: null,
          error: `PDF appears to be corrupted: ${errorMessage}`,
          errorCode: "CORRUPTED_PDF",
          processingTimeMs: performance.now() - startTime,
        };
      }

      return {
        success: false,
        data: null,
        error: `Failed to load PDF: ${errorMessage}`,
        errorCode: "CORRUPTED_PDF",
        processingTimeMs: performance.now() - startTime,
      };
    }

    const totalPages = pdf.numPages;
    if (totalPages === 0) {
      return {
        success: false,
        data: null,
        error: "PDF contains no pages",
        errorCode: "EMPTY_PDF",
        processingTimeMs: performance.now() - startTime,
      };
    }

    // Initialize result
    const result: ParsedPurchaseOrder = {
      header: {
        poNumber: null,
        orderDate: null,
        vendorName: null,
        vendorAddress: null,
        shipToAddress: null,
        billToAddress: null,
        paymentTerms: null,
        shippingMethod: null,
      },
      lineItems: [],
      totals: {
        subtotal: null,
        tax: null,
        shipping: null,
        grandTotal: null,
      },
      overallConfidence: 0,
      totalPages,
      pagesParsed: 0,
      warnings: [],
    };

    // Process each page with multi-page context
    const pagesToProcess = Math.min(totalPages, opts.maxPages);
    let allText = "";

    // Initialize multi-page context for tracking continuations
    let multiPageContext: MultiPageContext = {
      columnPositions: null,
      pendingLineItem: null,
      inLineItemsSection: false,
      lastPageEndY: 0,
    };

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      const processPage = async (): Promise<void> => {
        const page = await pdf.getPage(pageNum);
        const pageText = await extractPageText(page);

        if (opts.verbose) {
          console.log(`Page ${pageNum} text:`, pageText.substring(0, 200));
        }

        allText += pageText + "\n\n";

        // Extract line items from this page with context
        const { items: pageLineItems, updatedContext } = extractLineItems(
          pageText,
          pageNum,
          opts.enableMultiPageMerge ? multiPageContext : undefined
        );

        // Update context for next page
        if (opts.enableMultiPageMerge) {
          multiPageContext = updatedContext;
        }

        result.lineItems.push(...pageLineItems);
        result.pagesParsed++;
      };

      try {
        // Use retry logic with timeout for robustness
        await withRetry(
          () => withTimeout(processPage(), opts.pageTimeoutMs, `Page ${pageNum} processing timed out`),
          opts.maxRetries,
          (attempt, error) => {
            if (opts.verbose) {
              console.warn(`Retry ${attempt} for page ${pageNum}: ${error.message}`);
            }
          }
        );
      } catch (pageError) {
        const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
        result.warnings.push(`Failed to parse page ${pageNum} after ${opts.maxRetries + 1} attempts: ${errorMessage}`);

        // Continue processing other pages instead of failing completely
        if (opts.verbose) {
          console.error(`Skipping page ${pageNum}: ${errorMessage}`);
        }
      }
    }

    // Handle any remaining pending item from the last page
    if (multiPageContext.pendingLineItem && multiPageContext.pendingLineItem.description) {
      // Add the incomplete item with a warning
      result.lineItems.push({
        lineNumber: result.lineItems.length + 1,
        description: multiPageContext.pendingLineItem.description,
        itemCode: multiPageContext.pendingLineItem.itemCode || null,
        quantity: multiPageContext.pendingLineItem.quantity || 1,
        unitOfMeasure: multiPageContext.pendingLineItem.unitOfMeasure || null,
        unitPrice: multiPageContext.pendingLineItem.unitPrice || null,
        extendedPrice: multiPageContext.pendingLineItem.extendedPrice || null,
        confidence: 0.3, // Low confidence for incomplete items
        sourcePage: pagesToProcess,
        rawText: multiPageContext.pendingLineItem.rawText || multiPageContext.pendingLineItem.description,
      });
      result.warnings.push("Last line item may be incomplete (continued beyond parsed pages)");
    }

    if (allText.trim().length === 0) {
      return {
        success: false,
        data: null,
        error: "PDF contains no extractable text content. It may be a scanned image that requires OCR.",
        errorCode: "NO_TEXT_CONTENT",
        processingTimeMs: performance.now() - startTime,
      };
    }

    // Extract header and totals from combined text
    result.header = extractHeader(allText);
    result.totals = extractTotals(allText);

    // Merge duplicate line items if enabled
    if (opts.enableMultiPageMerge) {
      result.lineItems = mergeLineItems(result.lineItems);
    }

    // Filter line items by confidence threshold
    result.lineItems = result.lineItems.filter((item) => item.confidence >= opts.minConfidence);

    // Renumber line items
    result.lineItems.forEach((item, index) => {
      item.lineNumber = index + 1;
    });

    // Calculate overall confidence
    result.overallConfidence = calculateOverallConfidence(result);

    // Add warnings for missing data
    if (result.lineItems.length === 0) {
      result.warnings.push("No line items could be extracted from the PDF");
    }
    if (!result.header.poNumber) {
      result.warnings.push("PO number could not be identified");
    }
    if (pagesToProcess < totalPages) {
      result.warnings.push(
        `Only ${pagesToProcess} of ${totalPages} pages were processed due to page limit`
      );
    }

    return {
      success: true,
      data: result,
      processingTimeMs: performance.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: null,
      error: `PDF parsing failed: ${errorMessage}`,
      errorCode: "EXTRACTION_FAILED",
      processingTimeMs: performance.now() - startTime,
    };
  }
}

/**
 * Parse a purchase order PDF from a URL
 *
 * @param url - URL to the PDF file
 * @param options - Parsing options
 * @returns Parsed purchase order data
 */
export async function parsePurchaseOrderPdfFromUrl(
  url: string,
  options: PdfParseOptions = {}
): Promise<PdfParseResult> {
  const startTime = performance.now();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `Failed to fetch PDF: ${response.status} ${response.statusText}`,
        errorCode: "EXTRACTION_FAILED",
        processingTimeMs: performance.now() - startTime,
      };
    }

    const blob = await response.blob();
    const file = new File([blob], "document.pdf", { type: "application/pdf" });

    return parsePurchaseOrderPdf(file, options);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: null,
      error: `Failed to fetch PDF from URL: ${errorMessage}`,
      errorCode: "EXTRACTION_FAILED",
      processingTimeMs: performance.now() - startTime,
    };
  }
}

/**
 * Parse a purchase order PDF from an ArrayBuffer
 *
 * @param buffer - ArrayBuffer containing PDF data
 * @param filename - Optional filename for error messages
 * @param options - Parsing options
 * @returns Parsed purchase order data
 */
export async function parsePurchaseOrderPdfFromBuffer(
  buffer: ArrayBuffer,
  filename: string = "document.pdf",
  options: PdfParseOptions = {}
): Promise<PdfParseResult> {
  const file = new File([buffer], filename, { type: "application/pdf" });
  return parsePurchaseOrderPdf(file, options);
}

/**
 * Validate extracted line items for data quality
 *
 * @param items - Extracted line items to validate
 * @returns Validation results with issues found
 */
export function validateLineItems(items: ExtractedLineItem[]): {
  isValid: boolean;
  issues: Array<{ lineNumber: number; field: string; message: string }>;
} {
  const issues: Array<{ lineNumber: number; field: string; message: string }> = [];

  for (const item of items) {
    // Check for missing description
    if (!item.description || item.description.length < 3) {
      issues.push({
        lineNumber: item.lineNumber,
        field: "description",
        message: "Description is missing or too short",
      });
    }

    // Check for zero or negative quantity
    if (item.quantity <= 0) {
      issues.push({
        lineNumber: item.lineNumber,
        field: "quantity",
        message: "Quantity must be greater than zero",
      });
    }

    // Check for price consistency
    if (item.unitPrice !== null && item.extendedPrice !== null && item.quantity > 0) {
      const expectedExtended = item.unitPrice * item.quantity;
      const tolerance = 0.01; // 1 cent tolerance for rounding
      if (Math.abs(expectedExtended - item.extendedPrice) > tolerance) {
        issues.push({
          lineNumber: item.lineNumber,
          field: "extendedPrice",
          message: `Extended price (${item.extendedPrice}) doesn't match unit price (${item.unitPrice}) × quantity (${item.quantity})`,
        });
      }
    }

    // Check for low confidence
    if (item.confidence < 0.5) {
      issues.push({
        lineNumber: item.lineNumber,
        field: "confidence",
        message: `Low confidence extraction (${(item.confidence * 100).toFixed(0)}%)`,
      });
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Format line items for display or export
 *
 * @param items - Extracted line items
 * @returns Formatted items ready for display
 */
export function formatLineItemsForDisplay(
  items: ExtractedLineItem[]
): Array<{
  lineNumber: number;
  description: string;
  itemCode: string;
  quantity: string;
  unitPrice: string;
  extendedPrice: string;
  confidence: string;
}> {
  return items.map((item) => ({
    lineNumber: item.lineNumber,
    description: item.description,
    itemCode: item.itemCode || "-",
    quantity: `${item.quantity} ${item.unitOfMeasure || "EA"}`,
    unitPrice: item.unitPrice !== null ? `$${item.unitPrice.toFixed(2)}` : "-",
    extendedPrice: item.extendedPrice !== null ? `$${item.extendedPrice.toFixed(2)}` : "-",
    confidence: `${(item.confidence * 100).toFixed(0)}%`,
  }));
}
