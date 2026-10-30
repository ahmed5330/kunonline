# Direct customer statement PDF

Original source #84 now has a direct local PDF download beside the print button. Native browser canvas shapes Arabic; PDF embeds JPEG pages with explicit page dimensions, valid byte offsets and cross-reference table. A4, A5 and 80mm (200mm paginated sheets), recorded order fields, selected palette, local branding/logo and disclaimers are supported. No API calls, external service, carrier action, journal or browser storage is used. Content over 40,000 characters or 30 pages fails explicitly. Downloads do not create print-history success events.

The file is a raster customer statement, not a selectable-text PDF, fiscal invoice or payment receipt. HTML template decorations are not identically reproduced in PDF; palette and branding are retained. Detailed line prices/taxes are not invented. Internal notes and costs are excluded by an explicit field list.

Acceptance: Chromium generates all three sizes with long Arabic multipage content; tests verify header, trailer, every object/xref offset, oversize rejection and zero extra network requests. Independent pypdf opens all fixtures and verifies page dimensions; Poppler-rendered Arabic was visually inspected. Physical printing and authenticated live download remain untested.
