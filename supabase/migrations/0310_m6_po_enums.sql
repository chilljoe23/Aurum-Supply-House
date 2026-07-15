-- ============================================================================
-- Aurum Supply House · 0310 · M6 · Purchase-order enum extensions (ADDITIVE)
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Does not rewrite migrations 0001–0300. This file contains
-- NOTHING BUT `alter type … add value` statements and is deliberately isolated
-- in its own migration/transaction: PostgreSQL forbids USING a freshly-added
-- enum value in the same transaction that added it, so every later migration
-- (0320+) that references 'void' / 'testing_document' / 'shipping_document'
-- runs in a separate transaction and is safe.
--
--   po_status          + 'void'   — safe cancel of a not-yet-received PO
--   po_attachment_type + testing/shipping document categories (M6 requirement)
--
-- `if not exists` makes each addition idempotent.
-- ============================================================================

-- Void lets a PO be cancelled before goods are received without deleting its
-- audit trail (mirrors invoice_status 'void'). The 0330 transition state-machine
-- only permits void from pre-receipt states; received/closed POs can never void.
alter type po_status add value if not exists 'void';

-- The approved M6 attachment taxonomy is: manufacturer invoice · COA · packing
-- list · testing document · shipping document · general attachment. The base
-- enum (0001) already has manufacturer_invoice, coa, packing_list, tracking and
-- other; 'other' serves as "general attachment". Add the two missing document
-- categories here.
alter type po_attachment_type add value if not exists 'testing_document';
alter type po_attachment_type add value if not exists 'shipping_document';
